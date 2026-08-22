const express = require("express");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ROOT = path.join(__dirname, "sessions");
const logger = pino({ level: "fatal" });
const clients = new Map();

fs.mkdirSync(ROOT, { recursive: true });
app.use(express.json({limit:"32kb"}));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Danish Khan • WhatsApp PairCode</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#05060a;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial}
body:before{content:"";position:fixed;inset:-30%;z-index:-1;background:radial-gradient(circle at 15% 20%,#5b21b6,transparent 27%),radial-gradient(circle at 85% 20%,#075985,transparent 27%),radial-gradient(circle at 70% 85%,#047857,transparent 27%);filter:blur(55px)}
.wrap{width:min(700px,92%);margin:45px auto}.head{text-align:center}.tag{display:inline-block;padding:8px 14px;border:1px solid #343b4c;border-radius:99px;background:#0c1018;color:#c5ccdc;font-size:11px;font-weight:900;letter-spacing:.15em}
h1{font-size:clamp(38px,9vw,62px);line-height:1;margin:18px 0 7px;letter-spacing:-.055em}.sub{color:#929daf}
.card{margin-top:28px;padding:26px;border:1px solid #2a3241;border-radius:28px;background:#0b0e15f2;box-shadow:0 35px 100px #000b}
label{display:block;font-weight:900;margin-bottom:9px}input{width:100%;padding:17px;border-radius:15px;border:1px solid #364052;background:#07090e;color:#fff;font-size:18px;outline:0}.hint{font-size:12px;color:#7e899c;margin:8px 0 18px}
button{width:100%;padding:16px;border-radius:15px;border:1px solid #30394a;background:#171b24;color:#fff;font-weight:900;font-size:15px;cursor:pointer}.primary{border:0;background:linear-gradient(135deg,#7047ff,#a16cff)}
.code{margin-top:20px;text-align:center;padding:22px;border:1px dashed #465165;border-radius:18px;background:#070a10}.code small{color:#8994a8}.code b{display:block;margin-top:9px;font-size:34px;letter-spacing:.17em}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.status{margin-top:16px;padding:14px;border-radius:14px;background:#070a10;color:#b0bacb;font-size:14px}.ok{color:#00e3a0}.bad{color:#ff6d87}.note{margin-top:16px;color:#68758b;font-size:12px;line-height:1.6}
@media(max-width:520px){.card{padding:20px}.grid{grid-template-columns:1fr}.code b{font-size:27px}}
</style></head>
<body><div class="wrap"><div class="head"><span class="tag">DANISH KHAN • WA LINKER</span><h1>WhatsApp PairCode</h1><div class="sub">Pair your own WhatsApp account</div></div>
<div class="card">
<label>WhatsApp number</label><input id="num" inputmode="numeric" autocomplete="tel" value="917050407246">
<div class="hint">Country code included. Digits only — no +, spaces or dashes.</div>
<button class="primary" id="gen">Generate Pair Code</button>
<div class="code" id="codebox" hidden><small>PAIR CODE</small><b id="code">--------</b></div>
<div class="grid"><button id="copy">Copy Code</button><button id="check">Check Login</button></div>
<div class="grid"><button id="download">Download creds.json</button><button id="reset">New Session</button></div>
<div class="status" id="status">Ready.</div>
<div class="note">After entering the code in WhatsApp, wait until the status changes to LOGIN SUCCESS. Do not refresh during pairing.</div>
</div></div>
<script>
const $=x=>document.getElementById(x);let code="",timer=null;
function n(){return $("num").value.replace(/\\D/g,"")}
function show(t,c=""){$("status").className="status "+c;$("status").textContent=t}
function watch(number){
 clearInterval(timer);
 timer=setInterval(async()=>{
  try{
   const d=await (await fetch("/api/status?number="+encodeURIComponent(number))).json();
   if(d.status==="connected"){clearInterval(timer);show("LOGIN SUCCESS — WhatsApp device linked.","ok")}
   else if(d.status==="failed"||d.status==="logged_out"){clearInterval(timer);show(d.error||"WhatsApp connection closed.","bad")}
  }catch{}
 },2000)
}
$("gen").onclick=async()=>{
 const number=n();
 if(!/^\\d{7,15}$/.test(number))return show("Enter 7–15 digits including country code.","bad");
 $("gen").disabled=true;show("Starting WhatsApp pairing…");
 try{
  const r=await fetch("/api/pair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number})});
  const d=await r.json();
  if(!r.ok||!d.ok)throw new Error(d.error||"Pairing failed");
  code=d.code;$("code").textContent=code;$("codebox").hidden=false;
  show("Enter the code in WhatsApp → Linked devices → Link with phone number.","ok");
  watch(number);
 }catch(e){show(e.message,"bad")}finally{$("gen").disabled=false}
};
$("copy").onclick=async()=>{if(!code)return show("Generate a code first.");await navigator.clipboard.writeText(code);show("Pair code copied.","ok")};
$("check").onclick=async()=>{try{const d=await(await fetch("/api/status?number="+encodeURIComponent(n()))).json();show("Status: "+d.status+(d.credsSaved?" • creds.json saved":""))}catch{show("Status check failed.","bad")}};
$("download").onclick=()=>location.href="/api/download?number="+encodeURIComponent(n());
$("reset").onclick=async()=>{await fetch("/api/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:n()})});clearInterval(timer);$("codebox").hidden=true;code="";show("Fresh session ready.","ok")};
</script></body></html>`;

function digits(v){return String(v||"").replace(/\D/g,"")}
function valid(v){return /^\d{7,15}$/.test(v)}
function dir(n){return path.join(ROOT,n)}
function creds(n){return path.join(dir(n),"creds.json")}

async function startPairing(number){
  const old=clients.get(number);
  try{old?.sock?.end?.()}catch{}
  clients.delete(number);

  const d=dir(number);
  if(fs.existsSync(d)) fs.rmSync(d,{recursive:true,force:true});
  fs.mkdirSync(d,{recursive:true});

  const {state,saveCreds}=await useMultiFileAuthState(d);
  const {version,isLatest}=await fetchLatestBaileysVersion();
  console.log("Baileys WA Web version:",version.join("."),"latest:",isLatest);

  const sock=makeWASocket({
    version,
    logger,
    printQRInTerminal:false,
    auth:{
      creds:state.creds,
      keys:makeCacheableSignalKeyStore(state.keys,logger)
    },
    browser:Browsers.ubuntu("Chrome"),
    markOnlineOnConnect:true,
    syncFullHistory:false,
    connectTimeoutMs:60000,
    keepAliveIntervalMs:10000,
    defaultQueryTimeoutMs:60000,
    generateHighQualityLinkPreview:false
  });

  const job={sock,status:"connecting",error:null,code:null};
  clients.set(number,job);

  // This listener MUST stay attached for the entire socket lifetime.
  sock.ev.on("creds.update",saveCreds);

  sock.ev.on("connection.update",(update)=>{
    const {connection,lastDisconnect}=update;

    if(connection==="open"){
      job.status="connected";
      job.error=null;
      console.log("LOGIN SUCCESS",number);
    }

    if(connection==="close"){
      const code=lastDisconnect?.error?.output?.statusCode;
      if(code===DisconnectReason.loggedOut){
        job.status="logged_out";
        job.error="WhatsApp logged out this session.";
      }else{
        job.status="failed";
        job.error=code ? `WhatsApp connection closed (${code}).` : "WhatsApp connection closed.";
      }
      console.log("CONNECTION CLOSED",number,job.error);
    }
  });

  // Match the supplied working source's pairing timing.
  await new Promise(resolve=>setTimeout(resolve,3000));
  const pairCode=await sock.requestPairingCode(number);
  job.code=pairCode;

  return pairCode;
}

app.get("/",(req,res)=>res.type("html").send(html));
app.get("/health",(req,res)=>res.json({ok:true,service:"danish-khan-wa-paircode-fixed"}));

app.post("/api/pair",async(req,res)=>{
  const number=digits(req.body?.number);
  if(!valid(number))return res.status(400).json({ok:false,error:"Invalid number. Use country code and digits only."});
  try{
    const code=await startPairing(number);
    res.json({ok:true,code});
  }catch(e){
    console.error("PAIR ERROR",e);
    res.status(500).json({ok:false,error:"Pairing could not start. Check Render logs for the exact WhatsApp error."});
  }
});

app.get("/api/status",(req,res)=>{
  const number=digits(req.query.number);
  if(!valid(number))return res.status(400).json({ok:false,error:"Invalid number"});
  let registered=false;
  const f=creds(number);
  if(fs.existsSync(f)){
    try{registered=!!JSON.parse(fs.readFileSync(f,"utf8")).registered}catch{}
  }
  const j=clients.get(number);
  res.json({
    ok:true,
    status:registered?"connected":(j?.status||"idle"),
    error:j?.error||null,
    credsSaved:fs.existsSync(f)
  });
});

app.get("/api/download",(req,res)=>{
  const number=digits(req.query.number);
  if(!valid(number))return res.status(400).send("Invalid number");
  const f=creds(number);
  if(!fs.existsSync(f))return res.status(404).send("creds.json is not ready. Complete WhatsApp linking first.");
  res.download(f,"creds.json");
});

app.post("/api/reset",(req,res)=>{
  const number=digits(req.body?.number);
  if(!valid(number))return res.status(400).json({ok:false,error:"Invalid number"});
  try{clients.get(number)?.sock?.end?.()}catch{}
  clients.delete(number);
  const d=dir(number);
  if(fs.existsSync(d))fs.rmSync(d,{recursive:true,force:true});
  res.json({ok:true});
});

app.listen(PORT,"0.0.0.0",()=>console.log("DANISH KHAN WA PAIRCODE FIXED running on port "+PORT));
