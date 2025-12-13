// =====================
// IMPORTS (ADD THESE)
// =====================
const Alexa = require("ask-sdk-core");
const { ExpressAdapter } = require("ask-sdk-express-adapter");

// =====================
// EXISTING IMPORTS (UNCHANGED)
// =====================
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
app.use(cors());
app.use(express.json());

// =====================
// DATABASE POOL (UNCHANGED)
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

// 🔁 Helper: get latest reading directly from DB (NO API CALLS)
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

// =====================
// ALEXA HANDLERS
// =====================
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
      return i.responseBuilder
        .speak("I couldn't find any scans yet.")
        .getResponse();
    }

    return i.responseBuilder.speak(
      `Your latest scan shows ${latest.character_name} on ${latest.island_name}.
       Ultrasonic is ${latest.ultrasonic_value} centimeters,
       and LiDAR is ${latest.lidar_value} centimeters.`
    ).getResponse();
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
      return i.responseBuilder
        .speak("There are no scans to delete.")
        .getResponse();
    }

    await db.execute(
      "DELETE FROM readings WHERE reading_id = ?",
      [latest.reading_id]
    );

    return i.responseBuilder
      .speak("Deleted your latest scan.")
      .getResponse();
  },
};

// =====================
// ERROR HANDLER
// =====================
const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(i, err) {
    console.error("Alexa error:", err);
    return i.responseBuilder
      .speak("Sorry, something went wrong.")
      .getResponse();
  },
};

// =====================
// BUILD SKILL (NO LAMBDA)
// =====================
const skill = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    GetCharacterIntentHandler,
    DeleteScanIntentHandler
  )
  .addErrorHandlers(ErrorHandler)
  .create();

// =====================
// ALEXA ENDPOINT
// =====================
const adapter = new ExpressAdapter(skill, false, false);
app.post("/alexa", adapter.getRequestHandlers());

// =======================================================
// ================= EXISTING API ROUTES ==================
// =======================================================
// ⚠️ LEAVE EVERYTHING BELOW THIS LINE UNCHANGED
// (your /addReading, /latestReading, /updateReading, etc.)

// Health check
app.get("/", (req, res) => {
  res.send("One Piece IoT API is running ✅");
});

// Render PORT
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});