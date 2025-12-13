// =====================
// IMPORTS
// =====================
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const axios = require("axios");

const Alexa = require("ask-sdk-core");
const { ExpressAdapter } = require("ask-sdk-express-adapter");

// =====================
// EXPRESS APP
// =====================
const app = express();
app.use(cors());
app.use(express.json());

// =====================
// DATABASE (Render ENV)
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
// ALEXA CONFIG
// =====================
const SERVER_BASE_URL = "https://three40-project-5y9o.onrender.com";

// 🔥 NAME → ID MAPS (EDIT TO MATCH DB)
const ISLANDS = [
  { id: 1, name: "East Blue" },
  { id: 2, name: "Alabasta" },
];

const CHARACTERS = [
  { id: 1, name: "Luffy" },
  { id: 2, name: "Zoro" },
  { id: 3, name: "Nami" },
];

// =====================
// HELPER FUNCTIONS
// =====================
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

  const exact = list.find(x => norm(x.name) === target);
  if (exact) return exact.id;

  const partial = list.find(
    x => norm(x.name).includes(target) || target.includes(norm(x.name))
  );
  return partial ? partial.id : null;
}

async function apiGet(path) {
  return axios.get(`${SERVER_BASE_URL}${path}`, { timeout: 8000 });
}
async function apiPost(path, body) {
  return axios.post(`${SERVER_BASE_URL}${path}`, body, { timeout: 8000 });
}
async function apiPut(path, body) {
  return axios.put(`${SERVER_BASE_URL}${path}`, body, { timeout: 8000 });
}
async function apiDelete(path) {
  return axios.delete(`${SERVER_BASE_URL}${path}`, { timeout: 8000 });
}

async function getLatestReading() {
  const r = await apiGet("/latestReading");
  if (!r.data || r.data.message) return null;
  return r.data.row;
}

// =====================
// ALEXA HANDLERS
// =====================
const LaunchRequestHandler = {
  canHandle: i => Alexa.getRequestType(i.requestEnvelope) === "LaunchRequest",
  handle(i) {
    const speak =
      "You can ask for your latest scan, update a scan, delete it, or save a new one.";
    return i.responseBuilder.speak(speak).reprompt(speak).getResponse();
  },
};

const GetCharacterIntentHandler = {
  canHandle: i =>
    Alexa.getRequestType(i.requestEnvelope) === "IntentRequest" &&
    Alexa.getIntentName(i.requestEnvelope) === "GetCharacterIntent",
  async handle(i) {
    const latest = await getLatestReading();
    if (!latest) {
      return i.responseBuilder
        .speak("I couldn't find any scans yet.")
        .getResponse();
    }

    return i.responseBuilder.speak(
      `Your latest scan says ${latest.character_name} on ${latest.island_name}.
       Ultrasonic is ${latest.ultrasonic_value} centimeters,
       and LiDAR is ${latest.lidar_value} centimeters.`
    ).getResponse();
  },
};

const UpdateCharacterIntentHandler = {
  canHandle: i =>
    Alexa.getRequestType(i.requestEnvelope) === "IntentRequest" &&
    Alexa.getIntentName(i.requestEnvelope) === "UpdateCharacterIntent",
  async handle(i) {
    const slots = i.requestEnvelope.request.intent.slots || {};
    const character_id = findIdByName(CHARACTERS, slots.NewCharacter?.value);
    const island_id = findIdByName(ISLANDS, slots.NewIsland?.value);

    if (!character_id || !island_id) {
      return i.responseBuilder
        .speak("I couldn't match that island or character.")
        .getResponse();
    }

    const latest = await getLatestReading();
    if (!latest) {
      return i.responseBuilder.speak("No scans to update.").getResponse();
    }

    await apiPut(`/updateReading/${latest.reading_id}`, {
      island_id,
      character_id,
    });

    return i.responseBuilder
      .speak("Your scan has been updated.")
      .getResponse();
  },
};

const DeleteScanIntentHandler = {
  canHandle: i =>
    Alexa.getRequestType(i.requestEnvelope) === "IntentRequest" &&
    Alexa.getIntentName(i.requestEnvelope) === "DeleteScanIntent",
  async handle(i) {
    const latest = await getLatestReading();
    if (!latest) {
      return i.responseBuilder.speak("Nothing to delete.").getResponse();
    }

    await apiDelete(`/deleteReading/${latest.reading_id}`);
    return i.responseBuilder.speak("Deleted your latest scan.").getResponse();
  },
};

const SaveScanIntentHandler = {
  canHandle: i =>
    Alexa.getRequestType(i.requestEnvelope) === "IntentRequest" &&
    Alexa.getIntentName(i.requestEnvelope) === "SaveScanIntent",
  async handle(i) {
    const slots = i.requestEnvelope.request.intent.slots || {};
    const island_id = findIdByName(ISLANDS, slots.IslandName?.value);
    const character_id = findIdByName(CHARACTERS, slots.CharacterName?.value);

    if (!island_id || !character_id) {
      return i.responseBuilder
        .speak("Tell me an island and a character.")
        .getResponse();
    }

    await apiPost("/addReading", {
      ultrasonic_value: 0,
      lidar_value: 0,
      island_id,
      character_id,
    });

    return i.responseBuilder.speak("Scan saved.").getResponse();
  },
};

const ErrorHandler = {
  canHandle: () => true,
  handle(i, err) {
    console.error("Alexa Error:", err);
    return i.responseBuilder
      .speak("Sorry, something went wrong.")
      .getResponse();
  },
};

// =====================
// BUILD ALEXA SKILL (NO LAMBDA)
// =====================
const skill = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    GetCharacterIntentHandler,
    SaveScanIntentHandler,
    UpdateCharacterIntentHandler,
    DeleteScanIntentHandler
  )
  .addErrorHandlers(ErrorHandler)
  .create();

// =====================
// ALEXA EXPRESS ENDPOINT
// =====================
const adapter = new ExpressAdapter(skill, false, false);
app.post("/alexa", adapter.getRequestHandlers());

// =====================
// API ROUTES (UNCHANGED)
// =====================
app.post("/addReading", async (req, res) => {
  const { ultrasonic_value, lidar_value, island_id, character_id } = req.body;
  const sql =
    "INSERT INTO readings (ultrasonic_value, lidar_value, island_id, character_id) VALUES (?, ?, ?, ?)";
  const [r] = await db.execute(sql, [
    ultrasonic_value,
    lidar_value,
    island_id,
    character_id,
  ]);
  res.json({ ok: true, reading_id: r.insertId });
});

app.get("/latestReading", async (req, res) => {
  const sql = `
    SELECT r.reading_id, r.ultrasonic_value, r.lidar_value,
           i.island_name, c.character_name
    FROM readings r
    JOIN islands i ON r.island_id=i.island_id
    JOIN characters c ON r.character_id=c.character_id
    ORDER BY r.reading_id DESC LIMIT 1`;
  const [rows] = await db.query(sql);
  if (!rows.length) return res.json({ message: "No readings yet" });
  res.json({ row: rows[0] });
});

// =====================
// HEALTH CHECK
// =====================
app.get("/", (_, res) => res.send("One Piece IoT API running ✅"));

// =====================
// START SERVER
// =====================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);