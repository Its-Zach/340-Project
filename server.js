// server.js
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 DB connection (use env vars on Render)
const db = mysql.createConnection({
  host: process.env.DB_HOST || 'student-databases.cvode4s4cwrc.us-west-2.rds.amazonaws.com', // change to your host if needed
  user: process.env.DB_USER || 'jessetorres495',
  password: process.env.DB_PASS || 'XSoiRqCHeKaDhEbqX2XAlUuss8nJePiqI07',
  database: process.env.DB_NAME || 'jessetorres495'
});

db.connect(err => {
  if (err) {
    console.error('❌ DB connection error:', err);
  } else {
    console.log('✅ Connected to MySQL');
  }
});

// 1️⃣ CREATE / INSERT – Arduino uses this to send data
app.post('/addReading', (req, res) => {
  console.log('Received body:', req.body);
  const { ultrasonic_value, lidar_value, island_id, character_id } = req.body;

  const sql = `
    INSERT INTO readings (ultrasonic_value, lidar_value, island_id, character_id)
    VALUES (?, ?, ?, ?)
  `;

  db.query(sql, [ultrasonic_value, lidar_value, island_id, character_id], (err, result) => {
    if (err) {
      console.error('Error inserting reading:', err);
      return res.status(500).json({ error: 'DB insert failed' });
    }
    res.json({ message: 'Reading added', reading_id: result.insertId });
  });
});

// 2️⃣ READ – get ALL readings
app.get('/readings', (req, res) => {
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
      console.error('Error fetching readings:', err);
      return res.status(500).json({ error: 'DB query failed' });
    }
    res.json(results);
  });
});

// 3️⃣ READ – get LATEST reading (for Alexa)
app.get('/latestReading', (req, res) => {
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
      console.error('Error fetching latest reading:', err);
      return res.status(500).json({ error: 'DB query failed' });
    }

    if (results.length === 0) {
      return res.json({ message: 'No readings yet' });
    }

    res.json(results[0]);
  });
});

// 4️⃣ UPDATE – modify a reading (for rubric)
app.put('/updateReading/:id', (req, res) => {
  const readingId = req.params.id;
  const { island_id, character_id } = req.body;

  const sql = `
    UPDATE readings
    SET island_id = ?, character_id = ?
    WHERE reading_id = ?
  `;

  db.query(sql, [island_id, character_id, readingId], (err, result) => {
    if (err) {
      console.error('Error updating reading:', err);
      return res.status(500).json({ error: 'DB update failed' });
    }
    res.json({ message: 'Reading updated' });
  });
});

// 5️⃣ DELETE – remove a reading (for rubric)
app.delete('/deleteReading/:id', (req, res) => {
  const readingId = req.params.id;

  const sql = `
    DELETE FROM readings
    WHERE reading_id = ?
  `;

  db.query(sql, [readingId], (err, result) => {
    if (err) {
      console.error('Error deleting reading:', err);
      return res.status(500).json({ error: 'DB delete failed' });
    }
    res.json({ message: 'Reading deleted' });
  });
});

// Simple root route (for quick test)
app.get('/', (req, res) => {
  res.send('One Piece IoT API is running');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
