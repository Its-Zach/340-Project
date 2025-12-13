// ✅ INTEGRATED SERVER.JS - ALEXA SKILL + EXPRESS API (Following PDF instructions)
const Alexa = require('ask-sdk-core');
const express = require('express');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const cors = require('cors');
const axios = require('axios');
const mysql = require('mysql2/promise');

// =====================================================
// ✅ EXPRESS SETUP
// =====================================================
const app = express();
app.use(cors());
app.use(express.json());

// =====================================================
// ✅ DATABASE POOL (Render env vars)
// =====================================================
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
});

// =====================================================
// ✅ ALEXA SKILL CONFIGURATION
// =====================================================
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'https://three40-project-5y9o.onrender.com';

// 🔥 Name -> ID mapping (EDIT THESE to match your DB)
const ISLANDS = [
  { id: 1, name: 'East Blue' },
  { id: 2, name: 'Alabasta' },
  // add more...
];

const CHARACTERS = [
  { id: 1, name: 'Luffy' },
  { id: 2, name: 'Zoro' },
  { id: 3, name: 'Nami' },
  // add more...
];

// =====================================================
// ✅ HELPER FUNCTIONS FOR ALEXA SKILL
// =====================================================
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findIdByName(list, spokenName) {
  const target = norm(spokenName);
  if (!target) return null;

  // exact match
  const exact = list.find(x => norm(x.name) === target);
  if (exact) return exact.id;

  // partial match (helps when Alexa clips words)
  const partial = list.find(
    x => norm(x.name).includes(target) || target.includes(norm(x.name))
  );
  if (partial) return partial.id;

  return null;
}

// =====================================================
// ✅ ALEXA INTENT HANDLERS
// =====================================================

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  handle(handlerInput) {
    const speakOutput =
      "Yo. You can say: what's my latest scan, update my scan, delete my latest scan, or save a scan.";
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(speakOutput)
      .getResponse();
  },
};

// ✅ GET latest reading + speak it
const GetCharacterIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetCharacterIntent'
    );
  },
  async handle(handlerInput) {
    try {
      const sql = `
        SELECT 
          r.reading_id,
          r.ultrasonic_value,
          r.lidar_value,
          r.island_id,
          r.character_id,
          i.island_name,
          c.character_name
        FROM readings r
        INNER JOIN islands i ON r.island_id = i.island_id
        INNER JOIN characters c ON r.character_id = c.character_id
        ORDER BY r.reading_id DESC
        LIMIT 1
      `;

      const [rows] = await db.query(sql);

      if (rows.length === 0) {
        return handlerInput.responseBuilder
          .speak("I couldn't find any scans yet. Press the button on the Arduino to send one.")
          .getResponse();
      }

      const latest = rows[0];
      const speakOutput =
        `Your latest scan says ${latest.character_name} on ${latest.island_name}. ` +
        `Ultrasonic is ${latest.ultrasonic_value} centimeters, and LiDAR is ${latest.lidar_value} centimeters.`;

      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } catch (err) {
      console.log('GetCharacterIntent error:', err?.message || err);
      return handlerInput.responseBuilder
        .speak('Sorry, I could not retrieve your latest scan right now.')
        .getResponse();
    }
  },
};

// ✅ UPDATE latest reading using NAMES -> IDs
// Requires slots: NewCharacter, NewIsland
const UpdateCharacterIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'UpdateCharacterIntent'
    );
  },
  async handle(handlerInput) {
    try {
      const slots = handlerInput.requestEnvelope.request.intent.slots || {};
      const newCharacterName = slots.NewCharacter?.value;
      const newIslandName = slots.NewIsland?.value;

      const character_id = findIdByName(CHARACTERS, newCharacterName);
      const island_id = findIdByName(ISLANDS, newIslandName);

      if (!character_id || !island_id) {
        const speakOutput =
          "I couldn't match that island or character. Try saying something like: update my scan to Luffy on East Blue.";
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .reprompt(speakOutput)
          .getResponse();
      }

      // Get latest reading
      const getLatestSql = `
        SELECT reading_id FROM readings
        ORDER BY reading_id DESC
        LIMIT 1
      `;
      const [latestRows] = await db.query(getLatestSql);

      if (latestRows.length === 0) {
        return handlerInput.responseBuilder
          .speak('I do not see any scans to update yet. Send a scan first with the Arduino button.')
          .getResponse();
      }

      const reading_id = latestRows[0].reading_id;

      // Update the reading
      const updateSql = `
        UPDATE readings
        SET island_id = ?, character_id = ?
        WHERE reading_id = ?
      `;
      await db.execute(updateSql, [island_id, character_id, reading_id]);

      const speakOutput = `Done. I updated your latest scan to ${newCharacterName} on ${newIslandName}.`;
      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } catch (err) {
      console.log('UpdateCharacterIntent error:', err?.message || err);
      return handlerInput.responseBuilder
        .speak('Sorry, I could not update your latest scan right now.')
        .getResponse();
    }
  },
};

// ✅ DELETE latest reading
const DeleteScanIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'DeleteScanIntent'
    );
  },
  async handle(handlerInput) {
    try {
      // Get latest reading
      const getLatestSql = `
        SELECT reading_id FROM readings
        ORDER BY reading_id DESC
        LIMIT 1
      `;
      const [latestRows] = await db.query(getLatestSql);

      if (latestRows.length === 0) {
        return handlerInput.responseBuilder
          .speak("There aren't any scans to delete yet.")
          .getResponse();
      }

      const reading_id = latestRows[0].reading_id;

      // Delete the reading
      const deleteSql = `DELETE FROM readings WHERE reading_id = ?`;
      await db.execute(deleteSql, [reading_id]);

      return handlerInput.responseBuilder
        .speak('Deleted your latest scan.')
        .getResponse();
    } catch (err) {
      console.log('DeleteScanIntent error:', err?.message || err);
      return handlerInput.responseBuilder
        .speak('Sorry, I could not delete your latest scan right now.')
        .getResponse();
    }
  },
};

// ✅ INSERT via Alexa (rubric: Alexa must access ALL routes)
// Slots recommended: IslandName, CharacterName (optional: UltrasonicValue, LidarValue)
const SaveScanIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'SaveScanIntent'
    );
  },
  async handle(handlerInput) {
    try {
      const slots = handlerInput.requestEnvelope.request.intent.slots || {};

      const islandName = slots.IslandName?.value;
      const characterName = slots.CharacterName?.value;

      const ultrasonic_value = Number(slots.UltrasonicValue?.value ?? 0);
      const lidar_value = Number(slots.LidarValue?.value ?? 0);

      const island_id = findIdByName(ISLANDS, islandName);
      const character_id = findIdByName(CHARACTERS, characterName);

      if (!island_id || !character_id) {
        const speakOutput =
          'Tell me an island and a character. For example: save a scan for Luffy on East Blue.';
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .reprompt(speakOutput)
          .getResponse();
      }

      // Validate inputs
      if (
        !Number.isFinite(ultrasonic_value) ||
        !Number.isFinite(lidar_value) ||
        !Number.isInteger(island_id) ||
        !Number.isInteger(character_id)
      ) {
        return handlerInput.responseBuilder
          .speak('Invalid input. Please provide valid numbers and character names.')
          .getResponse();
      }

      // Insert into database
      const sql = `
        INSERT INTO readings (ultrasonic_value, lidar_value, island_id, character_id)
        VALUES (?, ?, ?, ?)
      `;
      const [result] = await db.execute(sql, [
        ultrasonic_value,
        lidar_value,
        island_id,
        character_id,
      ]);

      const speakOutput = `Saved. I added a scan for ${characterName} on ${islandName}.`;
      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } catch (err) {
      console.log('SaveScanIntent error:', err?.message || err);
      return handlerInput.responseBuilder
        .speak('Sorry, I could not save the scan right now.')
        .getResponse();
    }
  },
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent'
    );
  },
  handle(handlerInput) {
    const speakOutput =
      "Try: what's my latest scan, update my scan to Zoro on Alabasta, delete my latest scan, or save a scan for Luffy on East Blue.";
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(speakOutput)
      .getResponse();
  },
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent' ||
        Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent')
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.speak('Goodbye.').getResponse();
  },
};

const FallbackIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent'
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('I did not catch that. Try asking for your latest scan.')
      .reprompt('Try asking: what is my latest scan?')
      .getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    console.log('Session ended:', JSON.stringify(handlerInput.requestEnvelope));
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log('Error handled:', error?.message || error);
    return handlerInput.responseBuilder
      .speak('Sorry, something went wrong.')
      .reprompt('Try again.')
      .getResponse();
  },
};

// =====================================================
// ✅ BUILD ALEXA SKILL (Following PDF: use .create() instead of .lambda())
// =====================================================
const skill = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    GetCharacterIntentHandler,
    SaveScanIntentHandler,
    UpdateCharacterIntentHandler,
    DeleteScanIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .create();

// =====================================================
// ✅ EXPRESS ADAPTER (Following PDF instructions exactly)
// =====================================================
// Per PDF step 5: 
// - Set Alexa.SkillBuilder to a variable with const skill ✅
// - Use .create() instead of .lambda() ✅
// - The last two parameters for the new ExpressAdapter should be false and false ✅
const adapter = new ExpressAdapter(skill, false, false);

// =====================================================
// ✅ ALEXA SKILL ENDPOINT
// =====================================================
app.post('/', adapter.getRequestHandlers());

// =====================================================
// ✅ REST API ENDPOINTS (Arduino + optional client access)
// =====================================================

// Optional: DB health check
app.get('/db', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT 1 AS ok');
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1️⃣ CREATE / INSERT (Arduino posts here)
app.post('/addReading', async (req, res) => {
  console.log('📨 POST /addReading', req.body);

  const ultrasonic_value = Number(req.body.ultrasonic_value);
  const lidar_value = Number(req.body.lidar_value);
  const island_id = Number(req.body.island_id);
  const character_id = Number(req.body.character_id);

  // Validate (integers required)
  if (
    !Number.isFinite(ultrasonic_value) ||
    !Number.isFinite(lidar_value) ||
    !Number.isInteger(island_id) ||
    !Number.isInteger(character_id)
  ) {
    return res.status(400).json({
      ok: false,
      message:
        'Invalid input. Send ultrasonic_value, lidar_value (numbers) and island_id, character_id (integers).',
    });
  }

  try {
    const sql = `
      INSERT INTO readings (ultrasonic_value, lidar_value, island_id, character_id)
      VALUES (?, ?, ?, ?)
    `;
    const [result] = await db.execute(sql, [
      ultrasonic_value,
      lidar_value,
      island_id,
      character_id,
    ]);

    return res.json({
      ok: true,
      message: 'Reading added',
      reading_id: result.insertId,
      data: { ultrasonic_value, lidar_value, island_id, character_id },
    });
  } catch (err) {
    console.error('❌ insert error:', err);
    return res.status(500).json({
      ok: false,
      error: 'DB insert failed',
      details: err.message,
      code: err.code,
    });
  }
});

// 2️⃣ READ ALL (with INNER JOIN)
app.get('/readings', async (req, res) => {
  console.log('📖 GET /readings');

  const sql = `
    SELECT 
      r.reading_id,
      r.ultrasonic_value,
      r.lidar_value,
      r.island_id,
      r.character_id,
      i.island_name,
      c.character_name
    FROM readings r
    INNER JOIN islands i ON r.island_id = i.island_id
    INNER JOIN characters c ON r.character_id = c.character_id
    ORDER BY r.reading_id DESC
  `;

  try {
    const [rows] = await db.query(sql);
    res.json({ ok: true, count: rows.length, rows });
  } catch (err) {
    console.error('❌ read error:', err);
    res.status(500).json({ ok: false, error: 'DB query failed', details: err.message });
  }
});

// 3️⃣ READ LATEST (Alexa-friendly)
app.get('/latestReading', async (req, res) => {
  console.log('📖 GET /latestReading');

  const sql = `
    SELECT 
      r.reading_id,
      r.ultrasonic_value,
      r.lidar_value,
      r.island_id,
      r.character_id,
      i.island_name,
      c.character_name
    FROM readings r
    INNER JOIN islands i ON r.island_id = i.island_id
    INNER JOIN characters c ON r.character_id = c.character_id
    ORDER BY r.reading_id DESC
    LIMIT 1
  `;

  try {
    const [rows] = await db.query(sql);
    if (rows.length === 0) return res.json({ ok: true, message: 'No readings yet' });
    res.json({ ok: true, row: rows[0] });
  } catch (err) {
    console.error('❌ latest error:', err);
    res.status(500).json({ ok: false, error: 'DB query failed', details: err.message });
  }
});

// 4️⃣ UPDATE (edit island_id + character_id)
app.put('/updateReading/:id', async (req, res) => {
  const reading_id = Number(req.params.id);
  const island_id = Number(req.body.island_id);
  const character_id = Number(req.body.character_id);

  if (
    !Number.isInteger(reading_id) ||
    !Number.isInteger(island_id) ||
    !Number.isInteger(character_id)
  ) {
    return res.status(400).json({
      ok: false,
      message: 'id, island_id, character_id must be integers',
    });
  }

  try {
    const sql = `
      UPDATE readings
      SET island_id = ?, character_id = ?
      WHERE reading_id = ?
    `;
    const [result] = await db.execute(sql, [island_id, character_id, reading_id]);

    res.json({
      ok: true,
      message: 'Reading updated',
      affectedRows: result.affectedRows,
    });
  } catch (err) {
    console.error('❌ update error:', err);
    res.status(500).json({ ok: false, error: 'DB update failed', details: err.message });
  }
});

// 5️⃣ DELETE
app.delete('/deleteReading/:id', async (req, res) => {
  const reading_id = Number(req.params.id);

  if (!Number.isInteger(reading_id)) {
    return res.status(400).json({ ok: false, message: 'id must be an integer' });
  }

  try {
    const sql = `DELETE FROM readings WHERE reading_id = ?`;
    const [result] = await db.execute(sql, [reading_id]);

    res.json({
      ok: true,
      message: 'Reading deleted',
      affectedRows: result.affectedRows,
    });
  } catch (err) {
    console.error('❌ delete error:', err);
    res.status(500).json({ ok: false, error: 'DB delete failed', details: err.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('One Piece IoT API + Alexa Skill is running ✅');
});

// =====================================================
// ✅ START SERVER (Following PDF: app.listen() with port)
// =====================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Alexa Skill endpoint: POST /`);
  console.log(`✅ REST API endpoints: /addReading, /readings, /latestReading, /updateReading/:id, /deleteReading/:id`);
});