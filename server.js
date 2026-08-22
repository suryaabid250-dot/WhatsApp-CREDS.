const express = require("express");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 10000;
const SESSION_ROOT = path.join(__dirname, "session");
const logger = pino({ level: "silent" });
fs.mkdirSync(SESSION_ROOT, { recursive: true });
app.use(express.json({ limit: "16kb" }));

const jobs = new Map();

function cleanNumber(v) { return String(v || "").replace(/\D/g, ""); }
function validNumber(v) { return /^\d{7,15}$/.test(v); }
function sessionDir(n) { return path.join(SESSION_ROOT, n); }

async function createClient(number) {
  const dir = sessionDir(number);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  if (state.creds.registered) return { state, sock: null };

  let version;
  try {
    const latest = await fetchLatestBaileysVersion();
    version = latest.version;
    console.log("Using WA Web version:", version.join("."));
  } catch (e) {
    console.log("Latest version lookup failed; using library default.");
  }

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    logger,
    browser: Browsers.ubuntu("Chrome"),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false
  });

  const job = { sock, status: "connecting", error: null, code: null };
  jobs.set(number, job);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      job.status = "connected";
      job.error = null;
      console.log("LOGIN SUCCESS:", number);
    }
    if (connection === "close") {
      const status = lastDisconnect?.error?.output?.statusCode;
      job.status = "closed";
      job.error = status ? `Connection closed (${status})` : "Connection closed";
      console.log("CONNECTION CLOSED:", number, job.error);
    }
  });

  return { state, sock };
}

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Danish Khan • PairCode</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#05060a;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial}
body:before{content:"";position:fixed;inset:-30%;z-index:-1;background:radial-gradient(circle at 20% 20%,#5b21b6,transparent 28%),radial-gradient(circle at 85% 25%,#075985,transparent 28%),radial-gradient(circle at 70% 85%,#047857,transparent 28%);filter:blur(50px)}
.wrap{width:min(700px,92%);margin:48px auto}.head{text-align:center}.tag{display:inline-block;border:1px solid #343b4c;border-radius:99px;padding:8px 14px;font-size:11px;font-weight:900;letter-spacing:.15em;color:#c5ccdc;background:#0c1018}
h1{font-size:clamp(38px,9vw,62px);margin:18px 0 7px;letter-spacing:-.055em;line-height:1}.sub{color:#929daf}
.card{margin-top:28px;padding:26px;border-radius:28px;border:1px solid #2a3241;background:#0b0e15f2;box-shadow:0 35px 100px #000b}
label{display:block;font-weight:900;margin-bottom:9px}input{width:100%;padding:17px;border-radius:15px;border:1px solid #364052;background:#07090e;color:#fff;font-size:18px;outline:none}.hint{font-size:12px;color:#7e899c;margin:8px 0 18px}
button{width:100%;padding:16px;border-radius:15px;border:1px solid #30394a;background:#171b24;color:#fff;font-weight:900;font-size:15px;cursor:pointer}.primary{border:0;background:linear-gradient(135deg,#7047ff,#a16cff)}
.code{margin-top:20px;text-align:center;padding:22px;border:1px dashed #465165;border-radius:18px;background:#070a10}.code small{color:#8994a8}.code b{display:block;margin-top:9px;font-size:34px;letter-spacing:.17em}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.status{margin-top:16px;padding:14px;border-radius:14px;background:#070a10;color:#b0bacb;font-size:14px}.ok{color:#00e3a0}.bad{color:#ff6d87}
.note{margin-top:16px;color:#68758b;font-size:12px;line-height:1.6}@media(max-width:520px){.card{padding:20px}.grid{grid-template-columns:1fr}.code b{font-size:27px}}
</style></head><body><div class="wrap"><div class="head"><span class="tag">DANISH KHAN • WA CORE</span><h1>WhatsApp Pair Code</h1><div class="sub">Knightbase pairing flow</div></div>
<div class="card"><label>WhatsApp number</label><input id="n" inputmode="numeric" value="917050407246"><div class="hint">Country code included. Digits only.</div>
<button class="primary" id="go">Generate Pair Code</button>
<div id="box" class="code" hidden><small>PAIR CODE</small><b id="c">--------</b></div>
<div class="grid"><button id="copy">Copy Code</button><button id="st">Check Login</button></div>
<div class="grid"><button id="down">Download creds.json</button><button id="reset">Reset Session</button></div>
<div id="msg" class="status">Ready.</div>
<div class="note">Use only with a WhatsApp account you own. Never share creds.json or session keys.</div></div></div>
<script>
const $=id=>document.getElementById(id);let code="";let timer;
const num=()=>$("n").value.replace(/\\D/g,"");
function msg(t,c=""){$("msg").className="status "+c;$("msg").textContent=t}
function poll(n){clearInterval(timer);timer=setInterval(async()=>{try{const d=await(await fetch("/api/status?number="+encodeURIComponent(n))).json();if(d.status==="connected"){clearInterval(timer);msg("LOGIN SUCCESS — device linked.","ok")}else if(d.status==="closed"){clearInterval(timer);msg(d.error||"Connection closed.","bad")}}catch{}},2500)}
$("go").onclick=async()=>{const n=num();if(!/^\\d{7,15}$/.test(n))return msg("Enter 7–15 digits with country code.","bad");$("go").disabled=true;msg("Starting pairing…");try{const r=await fetch("/api/pair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:n})});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||"Pairing failed");code=d.code;$("c").textContent=code;$("box").hidden=false;msg("Enter this code in WhatsApp → Linked devices → Link with phone number.","ok");poll(n)}catch(e){msg(e.message,"bad")}finally{$("go").disabled=false}};
$("copy").onclick=async()=>{if(!code)return msg("Generate a code first.");await navigator.clipboard.writeText(code);msg("Copied.","ok")};
$("st").onclick=async()=>{const d=await(await fetch("/api/status?number="+encodeURIComponent(num()))).json();msg("Status: "+d.status+(d.credsSaved?" • creds.json saved":""))};
$("down").onclick=()=>location.href="/api/download?number="+encodeURIComponent(num());
$("reset").onclick=async()=>{await fetch("/api/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:num()})});clearInterval(timer);$("box").hidden=true;code="";msg("Session reset.","ok")};
</script></body></html>`;

app.get("/", (req,res)=>res.type("html").send(HTML));
app.get("/health", (req,res)=>res.json({ok:true}));

app.post("/api/pair", async (req,res)=>{
  const number=cleanNumber(req.body?.number);
  if(!validNumber(number)) return res.status(400).json({ok:false,error:"Invalid number. Use 7–15 digits including country code."});

  try {
    const old=jobs.get(number);
    try { old?.sock?.end?.(); } catch {}
    jobs.delete(number);

    // Start from a clean auth state for a new pairing attempt.
    const dir=sessionDir(number);
    if(fs.existsSync(dir)) fs.rmSync(dir,{recursive:true,force:true});

    const {state,sock}=await createClient(number);
    if(state.creds.registered) return res.json({ok:true,status:"connected",message:"Already linked."});

    // Same basic timing pattern used by the supplied Knightbot source.
    await new Promise(r=>setTimeout(r,3000));
    const code=await sock.requestPairingCode(number);
    const job=jobs.get(number); if(job) job.code=code;
    res.json({ok:true,code});
  } catch(e) {
    console.error("PAIR ERROR:",e);
    res.status(500).json({ok:false,error:"Could not generate pairing code. Check Render logs."});
  }
});

app.get("/api/status",(req,res)=>{
  const n=cleanNumber(req.query.number);
  if(!validNumber(n))return res.status(400).json({ok:false,error:"Invalid number"});
  let registered=false;const f=path.join(sessionDir(n),"creds.json");
  if(fs.existsSync(f)){try{registered=!!JSON.parse(fs.readFileSync(f,"utf8")).registered}catch{}}
  const j=jobs.get(n);
  res.json({ok:true,status:registered?"connected":(j?.status||"idle"),error:j?.error||null,credsSaved:fs.existsSync(f)});
});

app.get("/api/download",(req,res)=>{
  const n=cleanNumber(req.query.number);if(!validNumber(n))return res.status(400).send("Invalid number");
  const f=path.join(sessionDir(n),"creds.json");if(!fs.existsSync(f))return res.status(404).send("creds.json not available yet");
  res.download(f,"creds.json");
});

app.post("/api/reset",(req,res)=>{
  const n=cleanNumber(req.body?.number);if(!validNumber(n))return res.status(400).json({ok:false,error:"Invalid number"});
  try{jobs.get(n)?.sock?.end?.()}catch{}jobs.delete(n);
  const d=sessionDir(n);if(fs.existsSync(d))fs.rmSync(d,{recursive:true,force:true});
  res.json({ok:true});
});

app.listen(PORT,"0.0.0.0",()=>console.log("DANISH KHAN KNIGHTBASE running on port "+PORT));
