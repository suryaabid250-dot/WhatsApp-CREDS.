const express = require("express");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  DisconnectReason,
  delay
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const SESSIONS = path.join(__dirname, "sessions");
const logger = pino({ level: "silent" });

fs.mkdirSync(SESSIONS, { recursive: true });
app.use(express.json({ limit: "32kb" }));

const jobs = new Map();

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}
function valid(n) {
  return /^\d{7,15}$/.test(n);
}
function folder(n) {
  return path.join(SESSIONS, n);
}
function credsFile(n) {
  return path.join(folder(n), "creds.json");
}

async function makePairSocket(number) {
  const dir = folder(number);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  if (state.creds.registered) {
    return { state, sock: null };
  }

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    logger,
    browser: Browsers.macOS("Desktop"),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 20000
  });

  sock.ev.on("creds.update", saveCreds);

  const job = {
    sock,
    status: "connecting",
    code: null,
    error: null,
    createdAt: Date.now()
  };
  jobs.set(number, job);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      job.status = "connected";
      job.error = null;
    }
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      job.status =
        statusCode === DisconnectReason.loggedOut ? "logged_out" : "closed";
      if (statusCode) job.error = "WhatsApp connection closed: " + statusCode;
    }
  });

  return { state, sock };
}

async function generateCode(number) {
  // Always use a fresh session for a new pairing attempt.
  const old = jobs.get(number);
  try { old?.sock?.end?.(); } catch {}
  jobs.delete(number);

  const dir = folder(number);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const { state, sock } = await makePairSocket(number);
  if (state.creds.registered) {
    return { already: true };
  }

  // The official flow supports requestPairingCode once the socket is connecting.
  // A short delay lets the WebSocket initialize on cloud hosts.
  await delay(1500);

  const code = await sock.requestPairingCode(number);
  const job = jobs.get(number);
  if (job) job.code = code;

  return { code };
}

app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Danish Khan • WhatsApp Pair Code</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#fff;background:#05060a}
body:before{content:"";position:fixed;inset:-30%;z-index:-2;background:radial-gradient(circle at 18% 20%,#6d28d9 0,transparent 25%),radial-gradient(circle at 85% 18%,#0369a1 0,transparent 25%),radial-gradient(circle at 75% 85%,#047857 0,transparent 25%);filter:blur(48px)}
body:after{content:"";position:fixed;inset:0;z-index:-1;background:#05060ad9}
.wrap{width:min(720px,92%);margin:42px auto 60px}.head{text-align:center}.tag{display:inline-block;padding:8px 13px;border:1px solid #343b4c;border-radius:999px;background:#0d1018;color:#bdc5d6;font-size:11px;font-weight:900;letter-spacing:.15em}
h1{font-size:clamp(36px,9vw,62px);line-height:1;margin:17px 0 7px;letter-spacing:-.055em}.sub{color:#929caf}
.card{margin-top:28px;padding:26px;border:1px solid #2a3242;border-radius:28px;background:#0b0e15f0;box-shadow:0 35px 100px #000b;backdrop-filter:blur(18px)}
label{display:block;font-weight:850;margin-bottom:9px}input{width:100%;padding:17px;border-radius:15px;border:1px solid #353e50;background:#07090e;color:#fff;font-size:18px;outline:0}input:focus{border-color:#8b5cf6}
.hint{font-size:12px;color:#7f8a9e;margin:8px 0 18px}button{width:100%;padding:16px;border-radius:15px;border:1px solid #30394a;background:#171b24;color:#fff;font-size:15px;font-weight:900;cursor:pointer}.primary{border:0;background:linear-gradient(135deg,#6d45ff,#a06cff);box-shadow:0 16px 45px #704cff38}.primary:disabled{opacity:.55}
.code{margin-top:20px;padding:22px;text-align:center;border:1px dashed #465165;border-radius:18px;background:#070a10}.code small{color:#8994a8}.code b{display:block;margin-top:9px;font-size:34px;letter-spacing:.17em}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.status{margin-top:16px;padding:14px;border-radius:14px;background:#070a10;color:#aeb8c9;font-size:14px}.good{color:#00e3a0}.bad{color:#ff6b86}.note{margin-top:16px;color:#68758a;font-size:12px;line-height:1.6}
@media(max-width:520px){.card{padding:20px}.grid{grid-template-columns:1fr}.code b{font-size:27px}}
</style>
</head>
<body><div class="wrap">
<div class="head"><span class="tag">DANISH KHAN • WA LINKER</span><h1>WhatsApp Pair Code</h1><div class="sub">Link a WhatsApp account you own.</div></div>
<div class="card">
<label>WhatsApp number</label>
<input id="number" inputmode="numeric" autocomplete="tel" value="917050407246">
<div class="hint">Country code included. Digits only — no +, spaces or dashes.</div>
<button class="primary" id="gen">Generate Pair Code</button>
<div class="code" id="box" hidden><small>PAIR CODE</small><b id="code">--------</b></div>
<div class="grid"><button id="copy">Copy Code</button><button id="check">Check Status</button></div>
<div class="grid"><button id="download">Download creds.json</button><button id="reset">New Session</button></div>
<div class="status" id="status">Ready.</div>
<div class="note">Use only with a WhatsApp account you own. Never share creds.json or session key files.</div>
</div></div>
<script>
const $=id=>document.getElementById(id);let last="";
const num=()=>$("number").value.replace(/\\D/g,"");
function say(t,c=""){$("status").className="status "+c;$("status").textContent=t}
$("gen").onclick=async()=>{
 const n=num(); if(!/^\\d{7,15}$/.test(n)){say("Enter 7–15 digits including country code.","bad");return}
 $("gen").disabled=true;say("Starting a fresh WhatsApp pairing session…");
 try{
  const r=await fetch("/api/pair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:n})});
  const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Pairing failed");
  if(d.code){last=d.code;$("code").textContent=d.code;$("box").hidden=false;say("Code generated. Enter it immediately in WhatsApp → Linked devices → Link with phone number.","good")}
  else say(d.message||"A saved session already exists.","good");
 }catch(e){say(e.message,"bad")}finally{$("gen").disabled=false}
};
$("copy").onclick=async()=>{if(!last)return say("Generate a code first.");await navigator.clipboard.writeText(last);say("Pair code copied.","good")};
$("check").onclick=async()=>{const n=num();try{const d=await(await fetch("/api/status?number="+encodeURIComponent(n))).json();say("Status: "+d.status+(d.credsSaved?" • creds.json saved":""))}catch{say("Status check failed.","bad")}};
$("download").onclick=()=>location.href="/api/download?number="+encodeURIComponent(num());
$("reset").onclick=async()=>{const n=num();await fetch("/api/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:n})});$("box").hidden=true;last="";say("Session cleared. Generate a fresh code.","good")};
</script></body></html>`);
});

app.get("/health", (req, res) => res.json({ ok: true, service: "Danish Khan PairCode v2" }));

app.post("/api/pair", async (req, res) => {
  const number = digits(req.body?.number);
  if (!valid(number)) {
    return res.status(400).json({ ok:false, error:"Invalid number. Use 7–15 digits including country code." });
  }

  try {
    const result = await generateCode(number);
    if (result.already) {
      return res.json({ ok:true, status:"already_linked", message:"This session is already linked. Press New Session if you need to relink." });
    }
    res.json({ ok:true, code:result.code });
  } catch (err) {
    console.error("PAIR_ERROR", err);
    res.status(500).json({
      ok:false,
      error:"WhatsApp pairing failed. Press New Session and request a fresh code. If it repeats, check Render logs."
    });
  }
});

app.get("/api/status", (req, res) => {
  const number = digits(req.query.number);
  if (!valid(number)) return res.status(400).json({ok:false,error:"Invalid number"});
  let registered=false;
  const file=credsFile(number);
  if(fs.existsSync(file)){
    try{ registered=!!JSON.parse(fs.readFileSync(file,"utf8")).registered; }catch{}
  }
  res.json({ok:true,status:registered?"connected":(jobs.get(number)?.status||"idle"),credsSaved:fs.existsSync(file)});
});

app.get("/api/download", (req,res) => {
  const number=digits(req.query.number);
  if(!valid(number))return res.status(400).send("Invalid number");
  const file=credsFile(number);
  if(!fs.existsSync(file))return res.status(404).send("creds.json is not available yet. Link the account first.");
  res.download(file,"creds.json");
});

app.post("/api/reset", (req,res) => {
  const number=digits(req.body?.number);
  if(!valid(number))return res.status(400).json({ok:false,error:"Invalid number"});
  try{jobs.get(number)?.sock?.end?.();}catch{}
  jobs.delete(number);
  const dir=folder(number);
  if(fs.existsSync(dir))fs.rmSync(dir,{recursive:true,force:true});
  res.json({ok:true});
});

app.listen(PORT,"0.0.0.0",()=>console.log("DANISH KHAN PAIRCODE v2 running on port "+PORT));
