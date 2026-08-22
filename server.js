const express = require("express");
const path = require("path");
const fs = require("fs");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const AUTH_ROOT = path.join(__dirname, "auth_info");
const logger = pino({ level: "silent" });

fs.mkdirSync(AUTH_ROOT, { recursive: true });

app.use(express.json());
app.use(express.static(PUBLIC));

const sessions = new Map();

function cleanNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function validNumber(number) {
  return /^\d{7,15}$/.test(number);
}

function authDir(number) {
  return path.join(AUTH_ROOT, number);
}

async function createSocket(number) {
  const dir = authDir(number);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  if (state.creds.registered) {
    return { state, sock: null, saveCreds };
  }

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.ubuntu("Danish Khan WA Core"),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60000
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    const current = sessions.get(number);

    if (connection === "open") {
      if (current) current.status = "connected";
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (current) {
        current.status =
          code === DisconnectReason.loggedOut ? "logged_out" : "closed";
      }
      sessions.delete(number);
    }
  });

  sessions.set(number, { sock, status: "connecting" });
  return { state, sock, saveCreds };
}

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "Danish Khan WhatsApp Pair Code" });
});

app.post("/api/pair", async (req, res) => {
  try {
    const number = cleanNumber(req.body?.number);

    if (!validNumber(number)) {
      return res.status(400).json({
        ok: false,
        error: "Number must contain 7-15 digits including country code."
      });
    }

    const { state, sock } = await createSocket(number);

    if (state.creds.registered) {
      return res.json({
        ok: true,
        status: "already_linked",
        message: "A saved WhatsApp session already exists for this number."
      });
    }

    const code = await sock.requestPairingCode(number);

    res.json({
      ok: true,
      status: "pairing",
      number,
      code
    });
  } catch (error) {
    console.error("PAIR ERROR:", error);
    res.status(500).json({
      ok: false,
      error: "Could not generate pairing code. Check Render logs."
    });
  }
});

app.get("/api/status", (req, res) => {
  const number = cleanNumber(req.query.number);

  if (!validNumber(number)) {
    return res.status(400).json({ ok: false, error: "Invalid number." });
  }

  const creds = path.join(authDir(number), "creds.json");
  let registered = false;

  if (fs.existsSync(creds)) {
    try {
      registered = !!JSON.parse(fs.readFileSync(creds, "utf8")).registered;
    } catch {}
  }

  const current = sessions.get(number);

  res.json({
    ok: true,
    status: registered ? "connected" : (current?.status || "idle"),
    credsSaved: fs.existsSync(creds)
  });
});

app.get("/api/download-creds", (req, res) => {
  const number = cleanNumber(req.query.number);

  if (!validNumber(number)) return res.status(400).send("Invalid number.");

  const file = path.join(authDir(number), "creds.json");

  if (!fs.existsSync(file)) {
    return res.status(404).send("creds.json has not been generated yet.");
  }

  res.download(file, "creds.json");
});

app.post("/api/reset", (req, res) => {
  const number = cleanNumber(req.body?.number);

  if (!validNumber(number)) {
    return res.status(400).json({ ok: false, error: "Invalid number." });
  }

  const current = sessions.get(number);
  try { current?.sock?.end?.(); } catch {}

  sessions.delete(number);

  const dir = authDir(number);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  res.json({ ok: true });
});

// IMPORTANT: this must be after /api routes and static files.
app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`DANISH KHAN WA CORE running on port ${PORT}`);
});
