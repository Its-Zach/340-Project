const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const axios = require("axios");

const Alexa = require("ask-sdk-core");
const { ExpressAdapter } = require("ask-sdk-express-adapter");

const app = express();
app.use(cors());

// ✅ DO NOT add express.json() yet (Alexa needs raw body first)
const PUBLIC_BASE_URL =
  (process.env.PUBLIC_BASE_URL || "https://three40-project-5y9o.onrender.com").replace(/\/+$/, "");

// ✅ DB pool
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
});

// ---------- Helpers ----------
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findIdByName(rows, spoken) {
  const t = norm(spoken);
  if (!t) return null;

  const exact = rows.find((r) => norm(r.name) === t);
  if (exact) return exact.id;

  const partial = rows.find((r) => norm(r.name).includes(t) || t.includes(norm(r.name)));
  return partial ? partial.id : null;
}

async function getLatestReading() {
  const r = await axios.get(`${PUBLIC_BASE_URL}/latestReading`, { timeout: 8000 });
  if (!r.data || r.data.message) return null;
  return r.data;
}

// =========================
// Alexa Handlers (same intents)
// =========================

const LaunchRequestHandler = {
  canHandle(h) {
    return Alexa.getRequestType(h.requestEnvelope) === "LaunchRequest";
  },
  handle(h) {
    const speak =
      "Yo. You can say: what's my latest scan, update my scan, delete my latest scan, or save a scan.";
    return h.responseBuilder.speak(speak).reprompt(speak).getResponse();
  },
};

const GetCharacterIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(h.requestEnvelope) === "GetCharacterIntent"
    );
  },
  async handle(h) {
    try {
      const latest = await getLatestReading();
      if (!latest) {
        return h.responseBuilder
          .speak("No scans yet. Press the Arduino button to send one.")
          .getResponse();
      }

      const speak =
        `Your latest scan says ${latest.character_name} on ${latest.island_name}. ` +
        `Ultrasonic is ${latest.ultrasonic_value} centimeters, and LiDAR is ${latest.lidar_value} centimeters.`;

      return h.responseBuilder.speak(speak).getResponse();
    } catch (e) {
      console.log("GetCharacterIntent error:", e?.message || e);
      return h.responseBuilder.speak("Sorry, I couldn't retrieve your latest scan.").getResponse();
    }
  },
};

const UpdateCharacterIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(h.requestEnvelope) === "UpdateCharacterIntent"
    );
  },
  async handle(h) {
    try {
      const slots = h.requestEnvelope.request.intent.slots || {};
      const newIsland = slots.NewIsland?.value;
      const newChar = slots.NewCharacter?.value;

      const latest = await getLatestReading();
      if (!latest) {
        return h.responseBuilder.speak("No scans to update yet. Send one first.").getResponse();
      }

      // Fetch lookup tables from DB (no hardcoded arrays)
      const [islandsRes, charsRes] = await Promise.all([
        axios.get(`${PUBLIC_BASE_URL}/islands`, { timeout: 8000 }),
        axios.get(`${PUBLIC_BASE_URL}/characters`, { timeout: 8000 }),
      ]);

      const island_id = findIdByName(islandsRes.data.rows || [], newIsland);
      const character_id = findIdByName(charsRes.data.rows || [], newChar);

      if (!island_id || !character_id) {
        return h.responseBuilder
          .speak("I couldn't match that island or character. Try: update my scan to Luffy on East Blue.")
          .reprompt("Try: update my scan to Zoro on Alabasta.")
          .getResponse();
      }

      await axios.put(
        `${PUBLIC_BASE_URL}/updateReading/${latest.reading_id}`,
        { island_id, character_id },
        { timeout: 8000 }
      );

      return h.responseBuilder
        .speak(`Done. I updated your latest scan to ${newChar} on ${newIsland}.`)
        .getResponse();
    } catch (e) {
      console.log("UpdateCharacterIntent error:", e?.message || e);
      return h.responseBuilder.speak("Sorry, I couldn't update your latest scan.").getResponse();
    }
  },
};

const DeleteScanIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(h.requestEnvelope) === "DeleteScanIntent"
    );
  },
  async handle(h) {
    try {
      const latest = await getLatestReading();
      if (!latest) return h.responseBuilder.speak("There aren't any scans to delete.").getResponse();

      await axios.delete(`${PUBLIC_BASE_URL}/deleteReading/${latest.reading_id}`, { timeout: 8000 });

      return h.responseBuilder.speak("Deleted your latest scan.").getResponse();
    } catch (e) {
      console.log("DeleteScanIntent error:", e?.message || e);
      return h.responseBuilder.speak("Sorry, I couldn't delete your latest scan.").getResponse();
    }
  },
};

const SaveScanIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(h.requestEnvelope) === "SaveScanIntent"
    );
  },
  async handle(h) {
    try {
      const slots = h.requestEnvelope.request.intent.slots || {};
      const islandName = slots.IslandName?.value;
      const charName = slots.CharacterName?.value;

      const [islandsRes, charsRes] = await Promise.all([
        axios.get(`${PUBLIC_BASE_URL}/islands`, { timeout: 8000 }),
        axios.get(`${PUBLIC_BASE_URL}/characters`, { timeout: 8000 }),
      ]);

      const island_id = findIdByName(islandsRes.data.rows || [], islandName);
      const character_id = findIdByName(charsRes.data.rows || [], charName);

      if (!island_id || !character_id) {
        return h.responseBuilder
          .speak("Try: save a scan for Luffy on East Blue.")
          .reprompt("Try: save a scan for Zoro on Alabasta.")
          .getResponse();
      }

      await axios.post(
        `${PUBLIC_BASE_URL}/addReading`,
        { ultrasonic_value: 0, lidar_value: 0, island_id, character_id },
        { timeout: 8000 }
      );

      return h.responseBuilder
        .speak(`Saved. I added a scan for ${charName} on ${islandName}.`)
        .getResponse();
    } catch (e) {
      console.log("SaveScanIntent error:", e?.message || e);
      return h.responseBuilder.speak("Sorry, I couldn't save a scan right now.").getResponse();
    }
  },
};

const HelpIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(h.requestEnvelope) === "AMAZON.HelpIntent"
    );
  },
  handle(h) {
    const speak =
      "Try: what's my latest scan, update my scan to Luffy on East Blue, delete my latest scan, or save a scan for Zoro on Alabasta.";
    return h.responseBuilder.speak(speak).reprompt(speak).getResponse();
  },
};

const CancelAndStopIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" &&
      (Alexa.getIntentName(h.requestEnvelope) === "AMAZON.StopIntent" ||
        Alexa.getIntentName(h.requestEnvelope) === "AMAZON.CancelIntent")
    );
  },
  handle(h) {
    return h.responseBuilder.speak("Goodbye.").getResponse();
  },
};

const FallbackIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(h.requestEnvelope) === "AMAZON.FallbackIntent"
    );
  },
  handle(h) {
    return h.responseBuilder
      .speak("Try asking: what's my latest scan?")
      .reprompt("What's my latest scan?")
      .getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(h) {
    return Alexa.getRequestType(h.requestEnvelope) === "SessionEndedRequest";
  },
  handle(h) {
    return h.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(h, error) {
    console.log("Alexa error:", error?.message || error);
    return h.responseBuilder.speak("Sorry, something went wrong.").reprompt("Try again.").getResponse();
  },
};

// Build skill
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

// ✅ FIXED: options object API + skillId + verification
const adapter = new ExpressAdapter({
  skill,
  skillId: process.env.ALEXA_SKILL_ID,
  verifySignature: true,
  verifyTimestamp: true,
});

// ✅ FIXED: raw body for Alexa endpoint
app.post("/alexa", express.raw({ type: "application/json" }), adapter.getRequestHandlers());

// ✅ Now safe to parse JSON for normal routes
app.use(express.json());

// =========================
// REST API ROUTES
// =========================

app.get("/", (req, res) => res.send("One Piece IoT API is running ✅"));

app.get("/latestReading", async (req, res) => {
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
    if (rows.length === 0) return res.json({ message: "No readings yet" });
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ /latestReading error:", err);
    res.status(500).json({ error: "DB query failed", details: err.message });
  }
});

app.get("/islands", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT island_id AS id, island_name AS name FROM islands ORDER BY island_id"
    );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error("❌ /islands error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/characters", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT character_id AS id, character_name AS name FROM characters ORDER BY character_id"
    );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error("❌ /characters error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/addReading", async (req, res) => {
  try {
    const { ultrasonic_value, lidar_value, island_id, character_id } = req.body;

    if (
      ultrasonic_value === undefined ||
      lidar_value === undefined ||
      island_id === undefined ||
      character_id === undefined
    ) return res.status(400).json({ ok: false, message: "Missing required fields" });

    const sql = `
      INSERT INTO readings (ultrasonic_value, lidar_value, island_id, character_id)
      VALUES (?, ?, ?, ?)
    `;
    const [result] = await db.execute(sql, [
      Number(ultrasonic_value),
      Number(lidar_value),
      Number(island_id),
      Number(character_id),
    ]);

    res.json({ ok: true, message: "Reading added", reading_id: result.insertId });
  } catch (err) {
    console.error("❌ /addReading error:", err);
    res.status(500).json({ ok: false, error: err.message, code: err.code });
  }
});

app.put("/updateReading/:id", async (req, res) => {
  try {
    const readingId = Number(req.params.id);
    const island_id = Number(req.body.island_id);
    const character_id = Number(req.body.character_id);

    await db.query("UPDATE readings SET island_id = ?, character_id = ? WHERE reading_id = ?", [
      island_id,
      character_id,
      readingId,
    ]);

    res.json({ message: "Reading updated" });
  } catch (err) {
    console.error("❌ /updateReading error:", err);
    res.status(500).json({ error: "DB update failed", details: err.message });
  }
});

app.delete("/deleteReading/:id", async (req, res) => {
  try {
    const readingId = Number(req.params.id);
    await db.query("DELETE FROM readings WHERE reading_id = ?", [readingId]);
    res.json({ message: "Reading deleted" });
  } catch (err) {
    console.error("❌ /deleteReading error:", err);
    res.status(500).json({ error: "DB delete failed", details: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Combined server running on port ${PORT}`));
