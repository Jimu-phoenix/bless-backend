// Install dependencies first:
// npm install @vercel/blob express multer

import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { put } from '@vercel/blob';
import cors from 'cors'
import { Pool } from 'pg';


const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const portNumber = process.env.PORT;
app.use(cors())
app.use(express.json());

console.log(portNumber)


const pool = new Pool({
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT
})

app.get('/api/init', (req, res)=>{
    res.status(200).json({message: "Up and Running"})
})

app.get('/api/allProducts', async (req, res)=>{

    const client = await pool.connect();

    try {
        
        const result = await client.query('SELECT * FROM products');

        res.status(200).json( result.rows );


    } catch (error) {
        console.log("db error", error)
        res.status(500).json({message: "Internal Error"})
    }
    finally{
        client.release();
    }

})

app.post('/api/createOrder', async (req, res) =>{
   const client = await pool.connect();
    try {
      
      const { username, phone, email } = req.body.postData;

      const result = await client.query('INSERT INTO orders (username, email, phone_number) VALUES ($1, $2, $3) RETURNING id;', [username, email, phone])
      console.log(result.rows[0].id)
      res.status(200).json({id: result.rows[0].id})

    } catch (error) {
      console.log("Error: ", error)
      res.status(500).json({message: "Order Creation Error"})
    }
    finally{
      client.release();
    }
})
app.post('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { items } = req.body;
  const client = await pool.connect();

  try {
    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'No items provided' });
    }

    // Generate placeholders and values
    const placeholders = [];
    const values = [];
    
    items.forEach((item, i) => {
      const base = i * 3;
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
      values.push(id, item.id, item.quantity);
    });

    const query = `
      INSERT INTO order_product (order_id, product_id, qty)
      VALUES ${placeholders.join(', ')}
    `;

    const result = await client.query(query, values);

    res.status(200).json({ 
      message: 'Order Placed Successfully'
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Failed to add order items' });
  } finally {
    client.release();
  }
});

app.post('/api/postView', async (req, res) => {
    const client = await pool.connect();
    try {
      

      const result = await client.query('UPDATE views SET count = count + 1 WHERE id = 1;', [])
      console.log(result)
      res.status(200).json({message: "View Updated!"})

    } catch (error) {
      console.log("Error: ", error)
      res.status(500).json({message: "Views Error"})
    }
    finally{
      client.release();
    }
})

// --------------------------Getting and processing orders--------------//
app.get('/api/getOrders', async (req, res) => {
  const client = await pool.connect();
  
  try {
    
    const query = `SELECT 
          o.id,
          o.username,
          o.email,
          o.phone_number,
          COALESCE(
            json_agg(
              json_build_object(
                'product_id', oi.product_id,
                'product_name', p.product_name,
                'qty', oi.qty
              )
            ) FILTER (WHERE oi.product_id IS NOT NULL),
            '[]'::json
          ) as items
        FROM orders o
        LEFT JOIN order_product oi ON o.id = oi.order_id 
        LEFT JOIN products p ON oi.product_id = p.id
        GROUP BY o.id, o.username, o.email, o.phone_number
        ORDER BY o.id DESC;`

    const result = await client.query(query);
    res.status(200).json(result.rows);

  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  } finally {
    client.release();
  }
});

app.post('/api/processOrder/:orderId', async (req, res) => {
  const { orderId } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN'); // Start transaction

    // Get all items for this order
    const orderItems = await client.query(
      'SELECT product_id, qty FROM order_items WHERE order_id = $1',
      [orderId]
    );

    if (orderItems.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No items found for this order' });
    }

    // Update each product and sales record
    for (const item of orderItems.rows) {

      await client.query(
        'UPDATE products SET quantity = quantity - $1 WHERE id = $2',
        [item.qty, item.product_id]
      );

      await client.query(
        'UPDATE sales SET units = units + $1 WHERE product_id = $2',
        [item.qty, item.product_id]
      );
    }

    await client.query('COMMIT'); // Commit transaction

    res.status(200).json({ 
      message: 'Order processed successfully',
      itemsProcessed: orderItems.rows.length 
    });

  } catch (error) {
    await client.query('ROLLBACK'); // Rollback on error
    console.error('Error processing order:', error);
    res.status(500).json({ message: 'Failed to process order' });
  } finally {
    client.release();
  }
});

//-------------------------End----------------------------------------//

app.get('/api/catMetrics', async (req, res)=>{

   const client = await pool.connect();

    try {
        
        const result = await client.query('SELECT category FROM products');

        console.log(result.rows)
        let categories = {
          printer: 0,
          laptop: 0,
          screen: 0,
          acc: 0,
          other: 0
        }

        result.rows.forEach(prod => {
          switch (prod.category) {
            case 'other':
              categories.other = categories.other + 1;
            break;
            case 'accessory':
              categories.acc = categories.acc + 1;
            break;
            case 'screen':
              categories.screen = categories.screen + 1;
            break;
            case 'laptop':
              categories.laptop = categories.laptop + 1;
            break;
            case 'printer':
              categories.printer = categories.printer + 1;
            break;
            default:
              break;
          }
        })

        res.status(200).json( categories );


    } catch (error) {
        console.log("db error", error)
        res.status(500).json({message: "Internal Error"})
    }
    finally{
        client.release();
    }
})


app.get('/api/views', async (req, res)=>{

    const client = await pool.connect();

    try {
        
        const result = await client.query('SELECT count FROM views');

        console.log(result.rows)
        res.status(200).json( result.rows );


    } catch (error) {
        console.log("db error", error)
        res.status(500).json({message: "Internal Error"})
    }
    finally{
        client.release();
    }

})



app.get('/api/allMessages', async (req, res)=>{

    const client = await pool.connect();

    try {
        
        const result = await client.query('SELECT * FROM messages');

        res.status(200).json( result.rows );


    } catch (error) {
        console.log("db error", error)
        res.status(500).json({message: "Internal Error"})
    }
    finally{
        client.release();
    }

})

app.post('/api/postMessage', async (req, res)=>{
  const client = await pool.connect();
  try {
    
    const { fullname, email, message } = req.body.blabidi;

    await client.query('INSERT INTO messages (fullname, email, message) VALUES ($1, $2, $3);', [fullname, email, message])
    
    res.status(201).json({message: 'Your message was sent Successfully!'})
  } catch (error) {
    console.log("Message Post Error: ", error)
    res.status(500).json({message: 'Your Message was not posted due to an inernal server Error'})
  }
  finally{
    client.release();
  }
})

app.get('/api/productsCount', async (req, res)=>{
  const client = await pool.connect();

    try {
        
        const result = await client.query('SELECT id FROM products');

        // console.log(result)
        res.status(200).json( {count: result.rowCount} );


    } catch (error) {
        console.log("db error", error)
        res.status(500).json({message: "Internal Error"})
    }
    finally{
        client.release();
    }

})



app.get('/api/getProduct/:id', async (req, res)=>{
    const id = req.params.id
    const client = await pool.connect();

    try {
        
        const result = await client.query('SELECT * FROM products WHERE id = ($1)', [id]);

        res.status(200).json( result.rows[0] );


    } catch (error) {
        console.log("db error", error)
        res.status(500).json({message: "Internal Error"})
    }
    finally{
        client.release();
    }
})


// Update Route
app.put('/api/products/:id', upload.single('file'), async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const { name, make_model, category, desc, quantity, price } = req.body;

    // Start building the query
    let imageUrl = null;
    
    // If a new file is uploaded, upload to Vercel Blob
    if (req.file) {
      const blob = await put(req.file.originalname, req.file.buffer, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true
      });
      imageUrl = blob.url;
    }

    // Build dynamic update query based on what fields are provided
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`product_name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (category) {
      updates.push(`category = $${paramCount}`);
      values.push(category);
      paramCount++;
    }

     if (make_model) {
      updates.push(`make_model = $${paramCount}`);
      values.push(make_model);
      paramCount++;
    }

     if (quantity) {
      updates.push(`quantity = $${paramCount}`);
      values.push(parseInt(quantity));
      paramCount++;
    }

    if (desc) {
      updates.push(`description = $${paramCount}`);
      values.push(desc);
      paramCount++;
    }

    if (price) {
      updates.push(`price = $${paramCount}`);
      values.push(parseFloat(price));
      paramCount++;
    }

    if (imageUrl) {
      updates.push(`image_url = $${paramCount}`);
      values.push(imageUrl);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add id as the last parameter
    values.push(id);

    const query = `
      UPDATE products 
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.status(200).json({ 
      success: true,
      product: result.rows[0]
    });

  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Update failed', details: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    console.log("Called")
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { name, make_model, category, desc, quantity, price } = req.body;

    // Upload to Vercel Blob
    const blob = await put(req.file.originalname, req.file.buffer, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      allowOverwrite: true
    });

    const client = await pool.connect();
    const result = await client.query('INSERT INTO products (product_name, make_model, category, description, image_url, price, quantity) VALUES ($1, $2, $3, $4, $5, $6, $7)', [name, make_model, category, desc, blob.url, price, quantity])
    client.release();

    console.log("Uploaded")
    res.status(200).json({ 
      url: blob.url,
      pathname: blob.pathname,
      name: name,
      price: price
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});


app.delete('/api/deleteProduct/:id', async (req, res)=>{

    const { id } = req.params;
    const client = await pool.connect();

    try {
        
        const result = await client.query('DELETE FROM products WHERE id = $1 RETURNING id', [id])
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json({message: 'Successfully Deleted!'})


    } catch (error) {
        console.log('delete error: ', error)
        res.status(500).json({message: 'Internal Error!'})
    }
    finally{
        client.release();
    }
})

app.listen(portNumber, ()=>{
    console.log('Listening at', portNumber)
})