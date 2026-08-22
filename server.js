import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import makeWASocket, { DisconnectReason, useMultiFileAuthState, Browsers } from "@whiskeysockets/baileys";
import P from "pino";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const AUTH_DIR = path.join(__dirname, "auth_info");
const DEFAULT_PHONE = "917050407246";

app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

let sock = null;
let authState = null;
let saveCreds = null;
let starting = null;
let pairingInProgress = false;

let state = {
  status: "idle",
  pairingCode: null,
  phone: DEFAULT_PHONE,
  message: "Ready"
};

const logger = P({ level: process.env.LOG_LEVEL || "silent" });

function setStatus(status, message) {
  state.status = status;
  state.message = message;
}

function cleanPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

async function startSocket() {
  if (starting) return starting;

  starting = (async () => {
    const auth = await useMultiFileAuthState(AUTH_DIR);
    authState = auth.state;
    saveCreds = auth.saveCreds;

    const newSock = makeWASocket({
      auth: authState,
      browser: Browsers.ubuntu("Danish Khan WhatsApp Linker"),
      printQRInTerminal: false,
      logger,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      markOnlineOnConnect: false
    });

    sock = newSock;
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        setStatus("connected", "WhatsApp linked successfully");
        state.pairingCode = null;
        pairingInProgress = false;
      }

      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        sock = null;

        if (code === DisconnectReason.loggedOut) {
          pairingInProgress = false;
          setStatus("logged_out", "Logged out. Reset the session and pair again.");
        } else if (code === DisconnectReason.restartRequired) {
          setStatus("reconnecting", "WhatsApp requested a restart. Reconnecting...");
          try {
            await startSocket();
          } catch (err) {
            setStatus("error", err?.message || "Reconnect failed");
          }
        } else {
          pairingInProgress = false;
          setStatus("disconnected", `Connection closed (${code ?? "unknown"}).`);
        }
      }
    });

    return newSock;
  })();

  try {
    return await starting;
  } finally {
    starting = null;
  }
}

async function ensureSocket() {
  if (sock) return sock;
  return startSocket();
}

app.get("/api/status", (_req, res) => {
  res.json({
    ...state,
    credsExists: fs.existsSync(path.join(AUTH_DIR, "creds.json")),
    authDirExists: fs.existsSync(AUTH_DIR),
    registered: Boolean(authState?.creds?.registered)
  });
});

app.post("/api/pair", async (req, res) => {
  try {
    if (pairingInProgress) {
      return res.status(409).json({ ok: false, error: "A pairing request is already in progress. Please wait." });
    }

    let phone = cleanPhone(req.body?.phone || DEFAULT_PHONE);
    if (phone.startsWith("00")) phone = phone.slice(2);
    if (!/^\d{7,15}$/.test(phone)) {
      return res.status(400).json({ ok: false, error: "Enter a valid international WhatsApp number (7–15 digits, country code included)." });
    }

    const currentSock = await ensureSocket();

    if (authState?.creds?.registered) {
      return res.status(409).json({
        ok: false,
        error: "This auth_info folder is already linked. Reset the session before pairing another number."
      });
    }

    pairingInProgress = true;
    state.phone = phone;
    setStatus("pairing", "Preparing WhatsApp pairing code...");

    // WhatsApp needs the socket to initialize before requesting a pairing code.
    await new Promise(resolve => setTimeout(resolve, 1800));

    const code = await currentSock.requestPairingCode(phone);
    state.pairingCode = code;
    setStatus("waiting", "Enter this code in WhatsApp → Linked devices → Link with phone number");

    res.json({ ok: true, code, status: state });
  } catch (err) {
    pairingInProgress = false;
    console.error(err);
    setStatus("error", err?.message || "Pairing failed");
    res.status(500).json({ ok: false, error: err?.message || "Pairing failed" });
  }
});

app.get("/api/creds", (_req, res) => {
  const credsPath = path.join(AUTH_DIR, "creds.json");
  if (!fs.existsSync(credsPath)) {
    return res.status(404).json({ ok: false, error: "creds.json is not available yet. Pair the WhatsApp account first." });
  }
  res.download(credsPath, "creds.json");
});

app.post("/api/reset", async (_req, res) => {
  try {
    if (sock) {
      try { sock.end(undefined); } catch {}
      sock = null;
    }
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    authState = null;
    saveCreds = null;
    pairingInProgress = false;
    state = { status: "idle", pairingCode: null, phone: DEFAULT_PHONE, message: "Session deleted. Ready for a new pairing." };
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || "Reset failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Danish Khan WhatsApp Linker: http://localhost:${PORT}`);
});
