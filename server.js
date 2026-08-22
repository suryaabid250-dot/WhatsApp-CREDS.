const express = require("express");
const pino = require("pino");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestWaWebVersion,
  Browsers,
  DisconnectReason,
  delay
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const DATA = path.join(__dirname, "sessions");
const logger = pino({ level: "silent" });

fs.mkdirSync(DATA, { recursive: true });
app.use(express.json({ limit: "32kb" }));

const active = new Map();

const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Danish Khan • WhatsApp Linker</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#05060a;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial}
body:before{content:"";position:fixed;inset:-30%;z-index:-2;background:radial-gradient(circle at 15% 20%,#6d28d9,transparent 25%),radial-gradient(circle at 85% 20%,#0369a1,transparent 25%),radial-gradient(circle at 70% 85%,#047857,transparent 25%);filter:blur(55px)}
body:after{content:"";position:fixed;inset:0;z-index:-1;background:#05060add}
.wrap{width:min(720px,92%);margin:40px auto 60px}.head{text-align:center}.tag{display:inline-block;padding:8px 14px;border:1px solid #353c4d;border-radius:999px;background:#0d1018;color:#c1c9da;font-size:11px;font-weight:900;letter-spacing:.15em}
h1{font-size:clamp(38px,9vw,64px);line-height:1;margin:18px 0 7px;letter-spacing:-.055em}.sub{color:#909aac}.card{margin-top:28px;padding:26px;border:1px solid #2b3342;border-radius:28px;background:#0b0e15f2;box-shadow:0 35px 100px #000b}
label{display:block;font-weight:900;margin-bottom:9px}input{width:100%;padding:17px;border-radius:15px;border:1px solid #374052;background:#07090e;color:#fff;font-size:18px;outline:0}.hint{font-size:12px;color:#7d899d;margin:8px 0 18px}
button{width:100%;padding:16px;border-radius:15px;border:1px solid #30394a;background:#171b24;color:#fff;font-weight:900;font-size:15px;cursor:pointer}.primary{border:0;background:linear-gradient(135deg,#7047ff,#a16cff);box-shadow:0 16px 45px #704cff33}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.box{margin-top:20px;padding:22px;border:1px dashed #465166;border-radius:18px;background:#070a10;text-align:center}.box small{color:#8b96aa}.code{font-size:34px;letter-spacing:.17em;margin-top:9px;font-weight:900}.qr{max-width:240px;width:100%;border-radius:12px;margin:12px auto 0;background:#fff;padding:8px}
.status{margin-top:16px;padding:14px;border-radius:14px;background:#070a10;color:#b0bacb;font-size:14px}.good{color:#00e3a0}.bad{color:#ff6d87}.note{margin-top:15px;color:#68758b;font-size:12px;line-height:1.6}
@media(max-width:520px){.card{padding:20px}.grid{grid-template-columns:1fr}.code{font-size:27px}}
</style></head>
<body><div class="wrap"><div class="head"><span class="tag">DANISH KHAN • WA LINKER</span><h1>WhatsApp Linker</h1><div class="sub">Pair Code + QR fallback</div></div>
<div class="card">
<label>WhatsApp number</label><input id="number" inputmode="numeric" value="917050407246">
<div class="hint">Country code included. Digits only — no +, spaces or dashes.</div>
<button class="primary" id="pair">Generate Pair Code</button>
<div class="box" id="pairbox" hidden><small>PAIR CODE</small><div class="code" id="code">--------</div></div>
<div class="box" id="qrbox" hidden><small>QR FALLBACK</small><img class="qr" id="qr"></div>
<div class="grid"><button id="copy">Copy Code</button><button id="status">Check Login</button></div>
<div class="grid"><button id="download">Download creds.json</button><button id="reset">Fresh Session</button></div>
<div class="status" id="msg">Ready.</div>
<div class="note">Use only with a WhatsApp account you own. QR is provided as a fallback because WhatsApp's current pairing-code protocol can fail independently of the web app.</div>
</div></div>
<script>
const $=x=>document.getElementById(x);let code="",timer=null;
const n=()=>$( "number").value.replace(/\\D/g,"");
function say(t,c=""){$("msg").className="status "+c;$("msg").textContent=t}
async function poll(num){
 clearInterval(timer); timer=setInterval(async()=>{
  try{const d=await (await fetch("/api/status?number="+encodeURIComponent(num))).json();
   if(d.status==="connected"){clearInterval(timer);say("LOGIN SUCCESS — WhatsApp device linked.","good")}
   else if(d.status==="logged_out"||d.status==="error"){clearInterval(timer);say(d.error||"WhatsApp connection closed.","bad")}
  }catch{}
 },3000)
}
$("pair").onclick=async()=>{
 const num=n();if(!/^\\d{7,15}$/.test(num))return say("Enter 7–15 digits including country code.","bad");
 $("pair").disabled=true;say("Connecting to WhatsApp…");
 try{
  const r=await fetch("/api/pair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:num})});
  const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Pairing failed");
  if(d.code){code=d.code;$("code").textContent=d.code;$("pairbox").hidden=false;say("Enter the code immediately in WhatsApp → Linked devices → Link with phone number.","good")}
  if(d.qr){$("qr").src=d.qr;$("qrbox").hidden=false}
  poll(num);
 }catch(e){say(e.message,"bad")}finally{$("pair").disabled=false}
};
$("copy").onclick=async()=>{if(!code)return say("Generate a code first.");await navigator.clipboard.writeText(code);say("Code copied.","good")};
$("status").onclick=async()=>{try{const d=await(await fetch("/api/status?number="+encodeURIComponent(n()))).json();say("Status: "+d.status+(d.credsSaved?" • creds.json saved":""))}catch{say("Status check failed.","bad")}};
$("download").onclick=()=>location.href="/api/download?number="+encodeURIComponent(n());
$("reset").onclick=async()=>{await fetch("/api/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:n()})});clearInterval(timer);$("pairbox").hidden=true;$("qrbox").hidden=true;code="";say("Fresh session ready.","good")};
</script></body></html>`;

function digits(v){return String(v||"").replace(/\D/g,"")}
function valid(n){return /^\d{7,15}$/.test(n)}
function dir(n){return path.join(DATA,n)}
function creds(n){return path.join(dir(n),"creds.json")}

async function createSocket(number, wantPair){
  const d=dir(number);
  fs.mkdirSync(d,{recursive:true});
  const {state,saveCreds}=await useMultiFileAuthState(d);
  if(state.creds.registered)return {state,sock:null};

  let version;
  try { ({version}=await fetchLatestWaWebVersion({})) } catch {}

  const sock=makeWASocket({
    ...(version ? {version} : {}),
    auth:{creds:state.creds,keys:makeCacheableSignalKeyStore(state.keys,logger)},
    logger,
    browser:Browsers.macOS("Chrome"),
    printQRInTerminal:false,
    markOnlineOnConnect:false,
    syncFullHistory:false,
    generateHighQualityLinkPreview:false,
    connectTimeoutMs:120000,
    defaultQueryTimeoutMs:120000,
    keepAliveIntervalMs:15000
  });

  const job={sock,status:"connecting",error:null,qr:null,code:null};
  active.set(number,job);
  sock.ev.on("creds.update",saveCreds);

  sock.ev.on("connection.update",async(u)=>{
    if(u.qr){
      try{job.qr=await QRCode.toDataURL(u.qr)}catch{}
    }
    if(u.connection==="open"){job.status="connected";job.error=null}
    if(u.connection==="close"){
      const c=u.lastDisconnect?.error?.output?.statusCode;
      job.status=c===DisconnectReason.loggedOut?"logged_out":"error";
      job.error=c?`WhatsApp connection closed (${c}). Generate a fresh session.`:"WhatsApp connection closed.";
    }
  });

  return {state,sock};
}

app.get("/",(req,res)=>res.type("html").send(PAGE));
app.get("/health",(req,res)=>res.json({ok:true}));

app.post("/api/pair",async(req,res)=>{
  const number=digits(req.body?.number);
  if(!valid(number))return res.status(400).json({ok:false,error:"Invalid number. Use 7–15 digits including country code."});
  try{
    try{active.get(number)?.sock?.end?.()}catch{}
    active.delete(number);
    if(fs.existsSync(dir(number)))fs.rmSync(dir(number),{recursive:true,force:true});
    const {state,sock}=await createSocket(number,true);
    if(state.creds.registered)return res.json({ok:true,status:"connected",message:"This session is already linked."});
    await delay(1200);
    const code=await sock.requestPairingCode(number);
    const job=active.get(number);if(job)job.code=code;
    // Give the connection a little time to expose a QR fallback if pairing is rejected.
    await delay(500);
    res.json({ok:true,code,qr:job?.qr||null});
  }catch(e){
    console.error("PAIR ERROR",e);
    res.status(500).json({ok:false,error:"WhatsApp pairing could not start. Generate a fresh session and check Render logs."});
  }
});

app.get("/api/status",(req,res)=>{
  const number=digits(req.query.number);
  if(!valid(number))return res.status(400).json({ok:false,error:"Invalid number"});
  let registered=false;const f=creds(number);
  if(fs.existsSync(f)){try{registered=!!JSON.parse(fs.readFileSync(f,"utf8")).registered}catch{}}
  const j=active.get(number);
  res.json({ok:true,status:registered?"connected":(j?.status||"idle"),error:j?.error||null,credsSaved:fs.existsSync(f)});
});

app.get("/api/download",(req,res)=>{
  const n=digits(req.query.number);if(!valid(n))return res.status(400).send("Invalid number");
  const f=creds(n);if(!fs.existsSync(f))return res.status(404).send("creds.json is not available yet.");
  res.download(f,"creds.json");
});

app.post("/api/reset",(req,res)=>{
  const n=digits(req.body?.number);if(!valid(n))return res.status(400).json({ok:false,error:"Invalid number"});
  try{active.get(n)?.sock?.end?.()}catch{} active.delete(n);
  if(fs.existsSync(dir(n)))fs.rmSync(dir(n),{recursive:true,force:true});
  res.json({ok:true});
});

app.listen(PORT,"0.0.0.0",()=>console.log("DANISH KHAN WA LINKER FINAL on port "+PORT));
