// server.js (SINGLE FILE: Express API + MySQL + Alexa Web Service Hosting)
//
// Install:
// npm i express cors mysql2 ask-sdk-core ask-sdk-express-adapter

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const Alexa = require("ask-sdk-core");
const { ExpressAdapter } = require("ask-sdk-express-adapter");

const app = express();
app.use(cors());
app.use(express.json());

// =====================
// ✅ MySQL Pool (Render env vars)
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

// =====================
// ✅ Shared DB helpers
// =====================
async function dbPing() {
  const [rows] = await db.query("SELECT 1 AS ok");
  return rows;
}

async function insertReading({ ultrasonic_value, lidar_value, island_id, character_id }) {
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
  return result.insertId;
}

async function getAllReadings() {
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
  const [rows] = await db.query(sql);
  return rows;
}

async function getLatestReadingRow() {
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
  return rows.length ? rows[0] : null;
}

async function updateReading(reading_id, { island_id, character_id }) {
  const sql = `
    UPDATE readings
    SET island_id = ?, character_id = ?
    WHERE reading_id = ?
  `;
  const [result] = await db.execute(sql, [island_id, character_id, reading_id]);
  return result.affectedRows;
}

async function deleteReading(reading_id) {
  const sql = `DELETE FROM readings WHERE reading_id = ?`;
  const [result] = await db.execute(sql, [reading_id]);
  return result.affectedRows;
}

// =====================
// ✅ Express API Routes
// =====================

// Health check
app.get("/", (req, res) => {
  res.send("One Piece IoT API is running ✅");
});

// Optional DB ping
app.get("/db", async (req, res) => {
  try {
    const rows = await dbPing();
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// CREATE / INSERT (Arduino posts here)
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
    const reading_id = await insertReading({
      ultrasonic_value,
      lidar_value,
      island_id,
      character_id,
    });

    return res.json({
      ok: true,
      message: "Reading added",
      reading_id,
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

// READ ALL
app.get("/readings", async (req, res) => {
  console.log("📖 GET /readings");
  try {
    const rows = await getAllReadings();
    res.json({ ok: true, count: rows.length, rows });
  } catch (err) {
    console.error("❌ read error:", err);
    res.status(500).json({ ok: false, error: "DB query failed", details: err.message });
  }
});

// READ LATEST
app.get("/latestReading", async (req, res) => {
  console.log("📖 GET /latestReading");
  try {
    const row = await getLatestReadingRow();
    if (!row) return res.json({ ok: true, message: "No readings yet" });
    res.json({ ok: true, row });
  } catch (err) {
    console.error("❌ latest error:", err);
    res.status(500).json({ ok: false, error: "DB query failed", details: err.message });
  }
});

// UPDATE
app.put("/updateReading/:id", async (req, res) => {
  const reading_id = Number(req.params.id);
  const island_id = Number(req.body.island_id);
  const character_id = Number(req.body.character_id);

  if (!Number.isInteger(reading_id) || !Number.isInteger(island_id) || !Number.isInteger(character_id)) {
    return res.status(400).json({ ok: false, message: "id, island_id, character_id must be integers" });
  }

  try {
    const affectedRows = await updateReading(reading_id, { island_id, character_id });
    res.json({ ok: true, message: "Reading updated", affectedRows });
  } catch (err) {
    console.error("❌ update error:", err);
    res.status(500).json({ ok: false, error: "DB update failed", details: err.message });
  }
});

// DELETE
app.delete("/deleteReading/:id", async (req, res) => {
  const reading_id = Number(req.params.id);
  if (!Number.isInteger(reading_id)) {
    return res.status(400).json({ ok: false, message: "id must be an integer" });
  }

  try {
    const affectedRows = await deleteReading(reading_id);
    res.json({ ok: true, message: "Reading deleted", affectedRows });
  } catch (err) {
    console.error("❌ delete error:", err);
    res.status(500).json({ ok: false, error: "DB delete failed", details: err.message });
  }
});

// =====================
// ✅ Alexa Skill (IMPLEMENTED INSIDE THIS SAME SCRIPT)
// Requirements you requested:
// - MUST use .create() (not .lambda())
// - MUST use new ExpressAdapter(skill, false, false)
// - Hosted via Express (web service), not Lambda
// =====================

// Name -> ID mapping (EDIT to match your DB)
const ISLANDS = [
  { id: 1, name: "East Blue" },
  { id: 2, name: "Alabasta" },
];

const CHARACTERS = [
  { id: 1, name: "Luffy" },
  { id: 2, name: "Zoro" },
  { id: 3, name: "Nami" },
];

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findIdByName(list, spokenName) {
  const target = norm(spokenName);
  if (!target) return null;

  const exact = list.find((x) => norm(x.name) === target);
  if (exact) return exact.id;

  const partial = list.find(
    (x) => norm(x.name).includes(target) || target.includes(norm(x.name))
  );
  if (partial) return partial.id;

  return null;
}

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "LaunchRequest";
  },
  handle(handlerInput) {
    const speakOutput =
      "Yo. You can say: what's my latest scan, update my scan, delete my latest scan, or save a scan.";
    return handlerInput.responseBuilder.speak(speakOutput).reprompt(speakOutput).getResponse();
  },
};

const GetCharacterIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "GetCharacterIntent"
    );
  },
  async handle(handlerInput) {
    try {
      const latest = await getLatestReadingRow();
      if (!latest) {
        return handlerInput.responseBuilder
          .speak("I couldn't find any scans yet. Press the button on the Arduino to send one.")
          .getResponse();
      }

      const speakOutput =
        `Your latest scan says ${latest.character_name} on ${latest.island_name}. ` +
        `Ultrasonic is ${latest.ultrasonic_value} centimeters, and LiDAR is ${latest.lidar_value} centimeters.`;

      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } catch (err) {
      console.log("GetCharacterIntent error:", err?.message || err);
      return handlerInput.responseBuilder
        .speak("Sorry, I couldn't retrieve your latest scan right now.")
        .getResponse();
    }
  },
};

const UpdateCharacterIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "UpdateCharacterIntent"
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
          "I couldn't match that island or character. Try saying: update my scan to Luffy on East Blue.";
        return handlerInput.responseBuilder.speak(speakOutput).reprompt(speakOutput).getResponse();
      }

      const latest = await getLatestReadingRow();
      if (!latest) {
        return handlerInput.responseBuilder
          .speak("I don't see any scans to update yet. Send a scan first with the Arduino button.")
          .getResponse();
      }

      await updateReading(latest.reading_id, { island_id, character_id });

      const speakOutput = `Done. I updated your latest scan to ${newCharacterName} on ${newIslandName}.`;
      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } catch (err) {
      console.log("UpdateCharacterIntent error:", err?.message || err);
      return handlerInput.responseBuilder
        .speak("Sorry, I couldn't update your latest scan right now.")
        .getResponse();
    }
  },
};

const DeleteScanIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "DeleteScanIntent"
    );
  },
  async handle(handlerInput) {
    try {
      const latest = await getLatestReadingRow();
      if (!latest) {
        return handlerInput.responseBuilder.speak("There aren't any scans to delete yet.").getResponse();
      }

      await deleteReading(latest.reading_id);
      return handlerInput.responseBuilder.speak("Deleted your latest scan.").getResponse();
    } catch (err) {
      console.log("DeleteScanIntent error:", err?.message || err);
      return handlerInput.responseBuilder
        .speak("Sorry, I couldn't delete your latest scan right now.")
        .getResponse();
    }
  },
};

const SaveScanIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "SaveScanIntent"
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
          "Tell me an island and a character. For example: save a scan for Luffy on East Blue.";
        return handlerInput.responseBuilder.speak(speakOutput).reprompt(speakOutput).getResponse();
      }

      await insertReading({ ultrasonic_value, lidar_value, island_id, character_id });

      const speakOutput = `Saved. I added a scan for ${characterName} on ${islandName}.`;
      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } catch (err) {
      console.log("SaveScanIntent error:", err?.message || err);
      return handlerInput.responseBuilder
        .speak("Sorry, I couldn't save the scan right now.")
        .getResponse();
    }
  },
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.HelpIntent"
    );
  },
  handle(handlerInput) {
    const speakOutput =
      "Try: what's my latest scan, update my scan to Zoro on Alabasta, delete my latest scan, or save a scan for Luffy on East Blue.";
    return handlerInput.responseBuilder.speak(speakOutput).reprompt(speakOutput).getResponse();
  },
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.CancelIntent" ||
        Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.StopIntent")
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.speak("Goodbye.").getResponse();
  },
};

const FallbackIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.FallbackIntent"
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak("I didn't catch that. Try asking for your latest scan.")
      .reprompt("Try asking: what's my latest scan?")
      .getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "SessionEndedRequest";
  },
  handle(handlerInput) {
    console.log("Session ended:", JSON.stringify(handlerInput.requestEnvelope));
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log("Error handled:", error?.message || error);
    return handlerInput.responseBuilder
      .speak("Sorry, something went wrong.")
      .reprompt("Try again.")
      .getResponse();
  },
};

// ✅ REQUIRED: .create() (NOT .lambda())
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

// ✅ REQUIRED: new ExpressAdapter(skill, false, false)
const adapter = new ExpressAdapter(skill, false, false);

// ✅ DOC STYLE: Alexa endpoint on POST "/"
app.post("/", adapter.getRequestHandlers());

// =====================
// Server listen
// - Uses 3000 as default (doc example)
// - Still works on Render because it will use process.env.PORT if provided
// =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});