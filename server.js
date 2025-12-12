// server.js - Updated for Render deployment
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 DB connection (MUST use env vars on Render)
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});

db.connect(err => {
  if (err) {
    console.error('❌ DB connection error:', err);
    // Don't exit - try to reconnect
  } else {
    console.log('✅ Connected to MySQL');
  }
});

// Handle connection errors gracefully
db.on('error', (err) => {
  console.error('DB error:', err);
  if (err.code === 'PROTOCOL_CONNECTION_LOST') {
    db.connect();
  }
});

// 1️⃣ CREATE / INSERT – Arduino uses this to send data
app.post('/addReading', (req, res) => {
  console.log('📨 Received POST /addReading');
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  const { ultrasonic_value, lidar_value, island_id, character_id } = req.body;

  // Validate inputs
  if (ultrasonic_value === undefined || lidar_value === undefined || 
      island_id === undefined || character_id === undefined) {
    console.error('❌ Missing required fields');
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const sql = `
    INSERT INTO readings (ultrasonic_value, lidar_value, island_id, character_id)
    VALUES (?, ?, ?, ?)
  `;

  db.query(sql, [ultrasonic_value, lidar_value, island_id, character_id], (err, result) => {
    if (err) {
      console.error('❌ Error inserting reading:', err);
      return res.status(500).json({ error: 'DB insert failed', details: err.message });
    }
    console.log('✅ Data inserted successfully. ID:', result.insertId);
    res.json({ 
      message: 'Reading added', 
      reading_id: result.insertId,
      data: { ultrasonic_value, lidar_value, island_id, character_id }
    });
  });
});

// Alternative route name (if Arduino uses this)
app.post('/api/scans/snapshot', (req, res) => {
  console.log('📨 Received POST /api/scans/snapshot (redirecting to /addReading)');
  // Just forward to the main handler
  req.url = '/addReading';
  app.handle(req, res);
});

// 2️⃣ READ – get ALL readings
app.get('/readings', (req, res) => {
  console.log('📖 Received GET /readings');
  
  const sql = `
    SELECT 
      r.reading_id,
      r.ultrasonic_value,
      r.lidar_value,
      i.island_name,
      c.character_name
    FROM readings r
    INNER JOIN islands i ON r.island_id = i.island_id
    INNER JOIN characters c ON r.character_id = c.character_id
    ORDER BY r.reading_id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error('❌ Error fetching readings:', err);
      return res.status(500).json({ error: 'DB query failed' });
    }
    console.log(`✅ Found ${results.length} readings`);
    res.json(results);
  });
});

// 3️⃣ READ – get LATEST reading (for Alexa/Dashboard)
app.get('/latestReading', (req, res) => {
  console.log('📖 Received GET /latestReading');
  
  const sql = `
    SELECT 
      r.reading_id,
      r.ultrasonic_value,
      r.lidar_value,
      i.island_name,
      c.character_name
    FROM readings r
    INNER JOIN islands i ON r.island_id = i.island_id
    INNER JOIN characters c ON r.character_id = c.character_id
    ORDER BY r.reading_id DESC
    LIMIT 1
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error('❌ Error fetching latest reading:', err);
      return res.status(500).json({ error: 'DB query failed' });
    }

    if (results.length === 0) {
      return res.json({ message: 'No readings yet' });
    }

    console.log('✅ Latest reading retrieved');
    res.json(results[0]);
  });
});

// 4️⃣ UPDATE – modify a reading
app.put('/updateReading/:id', (req, res) => {
  const readingId = req.params.id;
  const { island_id, character_id } = req.body;

  console.log(`📝 Updating reading ${readingId}`);

  const sql = `
    UPDATE readings
    SET island_id = ?, character_id = ?
    WHERE reading_id = ?
  `;

  db.query(sql, [island_id, character_id, readingId], (err, result) => {
    if (err) {
      console.error('❌ Error updating reading:', err);
      return res.status(500).json({ error: 'DB update failed' });
    }
    console.log('✅ Reading updated');
    res.json({ message: 'Reading updated' });
  });
});

// 5️⃣ DELETE – remove a reading
app.delete('/deleteReading/:id', (req, res) => {
  const readingId = req.params.id;

  console.log(`🗑️ Deleting reading ${readingId}`);

  const sql = `
    DELETE FROM readings
    WHERE reading_id = ?
  `;

  db.query(sql, [readingId], (err, result) => {
    if (err) {
      console.error('❌ Error deleting reading:', err);
      return res.status(500).json({ error: 'DB delete failed' });
    }
    console.log('✅ Reading deleted');
    res.json({ message: 'Reading deleted' });
  });
});

// Health check route
app.get('/', (req, res) => {
  console.log('🏥 Health check received');
  res.send('One Piece IoT API is running ✅');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Access at: https://three40-project-5y9o.onrender.com`);
  console.log(`📍 Arduino should POST to: https://three40-project-5y9o.onrender.com:443/addReading`);
});