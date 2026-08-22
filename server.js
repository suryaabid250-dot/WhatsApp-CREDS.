const express = require("express");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 10000;
const ROOT = path.join(__dirname, "sessions");
const log = pino({ level: "silent" });

fs.mkdirSync(ROOT, { recursive: true });
app.use(express.json({ limit: "32kb" }));

const sockets = new Map();

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Danish Khan • WhatsApp Linker</title>
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial}
body{color:#fff;background:#05060a;overflow-x:hidden}
body:before{content:"";position:fixed;inset:-30%;z-index:-2;background:radial-gradient(circle at 15% 20%,#5b21b6 0,transparent 25%),radial-gradient(circle at 85% 15%,#075985 0,transparent 25%),radial-gradient(circle at 75% 85%,#0f766e 0,transparent 25%);filter:blur(45px)}
body:after{content:"";position:fixed;inset:0;z-index:-1;background:linear-gradient(135deg,#03040acc,#090b12e8 50%,#03040acc)}
.wrap{width:min(720px,92%);margin:42px auto 60px}
.head{text-align:center}.badge{display:inline-block;padding:8px 13px;border:1px solid #343b4c;border-radius:99px;background:#0d1018cc;color:#b8c0d2;font-size:11px;font-weight:900;letter-spacing:.15em}
h1{margin:17px 0 5px;font-size:clamp(36px,9vw,62px);line-height:1;letter-spacing:-.055em}
.sub{color:#8f99ad}
.card{margin-top:28px;padding:26px;border:1px solid #2b3241;border-radius:28px;background:#0b0e15e8;box-shadow:0 35px 100px #000a;backdrop-filter:blur(18px)}
label{display:block;font-weight:850;margin-bottom:9px}.hint{color:#7e899d;font-size:12px;margin:8px 0 18px}
input{width:100%;padding:17px;border-radius:15px;border:1px solid #353d4d;background:#07090e;color:#fff;font-size:18px;outline:none}input:focus{border-color:#8b5cf6}
button{width:100%;padding:16px;border-radius:15px;font-weight:900;font-size:15px;border:1px solid #303849;background:#171b24;color:#fff;cursor:pointer}
.primary{border:0;background:linear-gradient(135deg,#6d45ff,#9d6cff);box-shadow:0 16px 45px #704cff35}.primary:disabled{opacity:.6}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
.code{margin-top:20px;text-align:center;border:1px dashed #465064;background:#070a10;border-radius:18px;padding:22px}.code small{color:#8993a7}.code b{display:block;font-size:34px;letter-spacing:.16em;margin-top:9px}
.status{margin-top:16px;border-radius:14px;padding:14px;background:#070a10;color:#aeb7c7;font-size:14px}.good{color:#00df9a}.bad{color:#ff6d87}
.note{margin-top:16px;color:#68748a;font-size:12px;line-height:1.55}
@media(max-width:520px){.card{padding:20px}.grid{grid-template-columns:1fr}.code b{font-size:27px}}
</style>
</head>
<body>
<div class="wrap">
<div class="head"><span class="badge">DANISH KHAN • WA LINKER</span><h1>WhatsApp Pair Code</h1><div class="sub">Link a WhatsApp account you own.</div></div>
<div class="card">
<label for="number">WhatsApp number</label>
<input id="number" inputmode="numeric" value="917050407246" placeholder="917050407246">
<div class="hint">Country code included. Enter digits only — no +, spaces or dashes.</div>
<button class="primary" id="generate">Generate Pair Code</button>
<div class="code" id="codeBox" hidden><small>PAIR CODE</small><b id="code">--------</b></div>
<div class="grid"><button id="copy">Copy Code</button><button id="statusBtn">Check Status</button></div>
<div class="grid"><button id="download">Download creds.json</button><button id="reset">Reset Session</button></div>
<div class="status" id="status">Ready.</div>
<div class="note">Never share creds.json or session key files. They are authentication material for the linked WhatsApp account.</div>
</div></div>
<script>
const $=x=>document.getElementById(x);let lastCode="";
const number=()=>$("number").value.replace(/\\D/g,"");
function msg(t,c=""){$("status").className="status "+c;$("status").textContent=t}
$("generate").onclick=async()=>{
 const n=number(); if(!/^\\d{7,15}$/.test(n)){msg("Enter 7–15 digits including country code.","bad");return}
 $("generate").disabled=true;msg("Connecting to WhatsApp and requesting code…");
 try{
  const r=await fetch("/api/pair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:n})});
  const d=await r.json(); if(!r.ok||!d.ok)throw new Error(d.error||"Pairing failed");
  if(d.code){lastCode=d.code;$("code").textContent=d.code;$("codeBox").hidden=false;msg("Code generated. On your phone: WhatsApp → Linked devices → Link with phone number.","good")}
  else msg(d.message||"Session already exists.","good");
 }catch(e){msg(e.message,"bad")} finally{$("generate").disabled=false}
};
$("copy").onclick=async()=>{if(!lastCode)return msg("Generate a code first.");await navigator.clipboard.writeText(lastCode);msg("Code copied.","good")};
$("statusBtn").onclick=async()=>{try{const d=await(await fetch("/api/status?number="+encodeURIComponent(number()))).json();msg("Status: "+d.status+(d.credsSaved?" • creds.json saved":""))}catch(e){msg("Status check failed.","bad")}};
$("download").onclick=()=>location.href="/api/download?number="+encodeURIComponent(number());
$("reset").onclick=async()=>{if(!confirm("Delete this saved session?"))return;await fetch("/api/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:number()})});$("codeBox").hidden=true;lastCode="";msg("Session deleted.","good")};
</script>
</body>
</html>`;

function clean(n){return String(n||"").replace(/\D/g,"")}
function ok(n){return /^\d{7,15}$/.test(n)}
function dir(n){return path.join(ROOT,n)}

async function startSocket(number){
  const folder=dir(number);
  fs.mkdirSync(folder,{recursive:true});
  const {state,saveCreds}=await useMultiFileAuthState(folder);
  if(state.creds.registered) return {state,sock:null};

  const sock=makeWASocket({
    auth:state,
    logger:log,
    browser:Browsers.ubuntu("Danish Khan WA"),
    printQRInTerminal:false,
    markOnlineOnConnect:false,
    syncFullHistory:false,
    connectTimeoutMs:60000
  });
  sock.ev.on("creds.update",saveCreds);
  sockets.set(number,{sock,status:"connecting"});
  sock.ev.on("connection.update",({connection,lastDisconnect})=>{
    if(connection==="open") sockets.set(number,{sock,status:"connected"});
    if(connection==="close"){
      const code=lastDisconnect?.error?.output?.statusCode;
      sockets.set(number,{sock:null,status:code===DisconnectReason.loggedOut?"logged_out":"closed"});
    }
  });
  return {state,sock};
}

app.get("/",(req,res)=>res.type("html").send(page));
app.get("/health",(req,res)=>res.json({ok:true}));
app.post("/api/pair",async(req,res)=>{
  const number=clean(req.body?.number);
  if(!ok(number))return res.status(400).json({ok:false,error:"Invalid number. Use 7–15 digits with country code."});
  try{
    const {state,sock}=await startSocket(number);
    if(state.creds.registered)return res.json({ok:true,status:"already_linked",message:"Saved session already exists for this number."});
    const code=await sock.requestPairingCode(number);
    res.json({ok:true,code});
  }catch(e){
    console.error("PAIR ERROR",e);
    res.status(500).json({ok:false,error:"Pairing request failed. Check Render logs and try a fresh session."});
  }
});
app.get("/api/status",(req,res)=>{
  const n=clean(req.query.number);if(!ok(n))return res.status(400).json({ok:false,error:"Invalid number"});
  const c=path.join(dir(n),"creds.json");let registered=false;
  if(fs.existsSync(c)){try{registered=!!JSON.parse(fs.readFileSync(c,"utf8")).registered}catch{}}
  res.json({ok:true,status:registered?"connected":(sockets.get(n)?.status||"idle"),credsSaved:fs.existsSync(c)});
});
app.get("/api/download",(req,res)=>{
  const n=clean(req.query.number);if(!ok(n))return res.status(400).send("Invalid number");
  const f=path.join(dir(n),"creds.json");if(!fs.existsSync(f))return res.status(404).send("creds.json not available yet");
  res.download(f,"creds.json");
});
app.post("/api/reset",(req,res)=>{
  const n=clean(req.body?.number);if(!ok(n))return res.status(400).json({ok:false,error:"Invalid number"});
  try{sockets.get(n)?.sock?.end?.()}catch{}
  sockets.delete(n);if(fs.existsSync(dir(n)))fs.rmSync(dir(n),{recursive:true,force:true});
  res.json({ok:true});
});
app.listen(PORT,"0.0.0.0",()=>console.log("DANISH KHAN WA LINKER running on port "+PORT));
