// =====================
// IMPORTS
// =====================
const Alexa = require("ask-sdk-core");
const { ExpressAdapter } = require("ask-sdk-express-adapter");

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
app.use(cors());

// =====================
// DATABASE POOL
// =====================
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
});

// =======================================================
// ===================== ALEXA CODE =======================
// =======================================================

// Helper: get latest reading directly from DB
async function getLatestReading() {
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
  const [rows] = await db.query(sql);
  return rows.length ? rows[0] : null;
}

const LaunchRequestHandler = {
  canHandle(i) {
    return Alexa.getRequestType(i.requestEnvelope) === "LaunchRequest";
  },
  handle(i) {
    const speak =
      "You can ask for your latest scan, update your scan, delete it, or save one.";
    return i.responseBuilder.speak(speak).reprompt(speak).getResponse();
  },
};

const GetCharacterIntentHandler = {
  canHandle(i) {
    return (
      Alexa.getRequestType(i.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(i.requestEnvelope) === "GetCharacterIntent"
    );
  },
  async handle(i) {
    const latest = await getLatestReading();
    if (!latest) {
      return i.responseBuilder.speak("I couldn't find any scans yet.").getResponse();
    }

    const speak =
      `Your latest scan shows ${latest.character_name} on ${latest.island_name}. ` +
      `Ultrasonic is ${latest.ultrasonic_value} centimeters, ` +
      `and LiDAR is ${latest.lidar_value} centimeters.`;

    return i.responseBuilder.speak(speak).getResponse();
  },
};

const DeleteScanIntentHandler = {
  canHandle(i) {
    return (
      Alexa.getRequestType(i.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(i.requestEnvelope) === "DeleteScanIntent"
    );
  },
  async handle(i) {
    const latest = await getLatestReading();
    if (!latest) {
      return i.responseBuilder.speak("There are no scans to delete.").getResponse();
    }

    await db.execute("DELETE FROM readings WHERE reading_id = ?", [latest.reading_id]);

    return i.responseBuilder.speak("Deleted your latest scan.").getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(i, err) {
    console.error("Alexa error:", err);
    return i.responseBuilder.speak("Sorry, something went wrong.").getResponse();
  },
};

// ✅ BUILD SKILL (NO LAMBDA)
const skill = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    GetCharacterIntentHandler,
    DeleteScanIntentHandler
  )
  .addErrorHandlers(ErrorHandler)
  .create(); // ✅ REQUIRED (not .lambda())

// ✅ ALEXA ENDPOINT
const adapter = new ExpressAdapter(skill, false, false); // ✅ REQUIRED
app.post("/alexa", adapter.getRequestHandlers());        // ✅ matches your console endpoint

// =====================
// NOW enable JSON parsing for your API routes
// =====================
app.use(express.json());

// =======================================================
// ================= EXISTING API ROUTES ==================
// =======================================================

app.post("/addReading", async (req, res) => {
  console.log("📨 POST /addReading", req.body);

  const ultrasonic_value = Number(req.body.ultrasonic_value);
  const lidar_value = Number(req.body.lidar_value);
  const island_id = Number(req.body.island_id);
  const character_id = Number(req.body.character_id);

  if (
    !Number.isFinite(ultrasonic_value) ||
    !Number.isFinite(lidar_value) ||
    !Number.isInteger(island_id) ||
    !Number.isInteger(character_id)
  ) {
    return res.status(400).json({
      ok: false,
      message:
        "Invalid input. Send ultrasonic_value, lidar_value (numbers) and island_id, character_id (integers).",
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
      message: "Reading added",
      reading_id: result.insertId,
      data: { ultrasonic_value, lidar_value, island_id, character_id },
    });
  } catch (err) {
    console.error("❌ insert error:", err);
    return res.status(500).json({
      ok: false,
      error: "DB insert failed",
      details: err.message,
      code: err.code,
    });
  }
});

app.get("/readings", async (req, res) => {
  console.log("📖 GET /readings");

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
    console.error("❌ read error:", err);
    res.status(500).json({ ok: false, error: "DB query failed", details: err.message });
  }
});

app.get("/latestReading", async (req, res) => {
  console.log("📖 GET /latestReading");

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
    if (rows.length === 0) return res.json({ ok: true, message: "No readings yet" });
    res.json({ ok: true, row: rows[0] });
  } catch (err) {
    console.error("❌ latest error:", err);
    res.status(500).json({ ok: false, error: "DB query failed", details: err.message });
  }
});

app.put("/updateReading/:id", async (req, res) => {
  const reading_id = Number(req.params.id);
  const island_id = Number(req.body.island_id);
  const character_id = Number(req.body.character_id);

  if (!Number.isInteger(reading_id) || !Number.isInteger(island_id) || !Number.isInteger(character_id)) {
    return res.status(400).json({ ok: false, message: "id, island_id, character_id must be integers" });
  }

  try {
    const sql = `
      UPDATE readings
      SET island_id = ?, character_id = ?
      WHERE reading_id = ?
    `;
    const [result] = await db.execute(sql, [island_id, character_id, reading_id]);

    res.json({ ok: true, message: "Reading updated", affectedRows: result.affectedRows });
  } catch (err) {
    console.error("❌ update error:", err);
    res.status(500).json({ ok: false, error: "DB update failed", details: err.message });
  }
});

app.delete("/deleteReading/:id", async (req, res) => {
  const reading_id = Number(req.params.id);

  if (!Number.isInteger(reading_id)) {
    return res.status(400).json({ ok: false, message: "id must be an integer" });
  }

  try {
    const sql = `DELETE FROM readings WHERE reading_id = ?`;
    const [result] = await db.execute(sql, [reading_id]);

    res.json({ ok: true, message: "Reading deleted", affectedRows: result.affectedRows });
  } catch (err) {
    console.error("❌ delete error:", err);
    res.status(500).json({ ok: false, error: "DB delete failed", details: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("One Piece IoT API is running ✅");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});