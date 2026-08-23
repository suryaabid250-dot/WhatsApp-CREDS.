const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  Browsers,
  DisconnectReason,
  delay
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const ROOT = path.join(__dirname, 'sessions');
const log = pino({ level: process.env.LOG_LEVEL || 'warn' });
const sessions = new Map();

fs.mkdirSync(ROOT, { recursive: true });
app.use(express.json({ limit: '32kb' }));

const digits = v => String(v || '').replace(/\D/g, '');
const validNumber = v => /^\d{7,15}$/.test(v);
const sessionDir = n => path.join(ROOT, n);
const credsFile = n => path.join(sessionDir(n), 'creds.json');

async function getWhatsAppVersion() {
  // WhatsApp can reject an otherwise-valid Baileys build when its bundled
  // Web client revision is stale. Prefer the live revision from web.whatsapp.com.
  try {
    if (typeof fetchLatestWaWebVersion === 'function') {
      const r = await fetchLatestWaWebVersion();
      if (r && Array.isArray(r.version)) return r.version;
    }
  } catch (e) {
    console.warn('Live WA Web version lookup failed:', e.message);
  }

  try {
    const r = await fetchLatestBaileysVersion();
    if (r && Array.isArray(r.version)) return r.version;
  } catch (e) {
    console.warn('Baileys version lookup failed:', e.message);
  }

  return undefined;
}

async function createSocket(number, existingSession) {
  let entry = sessions.get(number);
  if (entry?.sock && !entry.restarting) return entry;

  const dir = sessionDir(number);
  fs.mkdirSync(dir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const version = await getWhatsAppVersion();

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, log)
    },
    // Windows/Chrome is currently accepted by WhatsApp's pairing-code validation.
    browser: Browsers.windows('Chrome'),
    logger: log,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    connectTimeoutMs: 90000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 15000,
    generateHighQualityLinkPreview: false
  });

  entry = existingSession || {
    number,
    sock: null,
    status: 'connecting',
    error: null,
    qr: null,
    code: null,
    pairingRequested: false,
    reconnects: 0,
    intentionalReset: false,
    restarting: false,
    connectedAt: null
  };
  entry.sock = sock;
  entry.status = 'connecting';
  entry.error = null;
  entry.qr = null;
  sessions.set(number, entry);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async update => {
    const { connection, qr, isNewLogin, lastDisconnect } = update;

    if (qr && !entry.pairingRequested && !state.creds.registered) {
      entry.qr = await QRCode.toDataURL(qr);
      entry.status = 'waiting';
    }

    if (isNewLogin) {
      // Baileys' pairing flow emits isNewLogin after the phone accepts the code.
      // The protocol expects the socket to be restarted with the newly saved auth.
      entry.status = 'auth-saved';
      entry.error = null;
      setTimeout(() => restartSocket(number, entry), 1000);
      return;
    }

    if (connection === 'open') {
      entry.status = 'connected';
      entry.error = null;
      entry.connectedAt = new Date().toISOString();
      entry.reconnects = 0;
      return;
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      entry.sock = null;

      if (loggedOut || entry.intentionalReset) {
        entry.status = 'logged_out';
        entry.error = loggedOut ? 'WhatsApp logged out this session.' : 'Session reset.';
        return;
      }

      entry.status = 'reconnecting';
      entry.error = `WhatsApp connection closed${code ? ` (${code})` : ''}`;
      if (entry.reconnects < 8) {
        const wait = Math.min(15000, 1500 * Math.pow(1.5, entry.reconnects));
        entry.reconnects++;
        setTimeout(() => restartSocket(number, entry), wait);
      } else {
        entry.status = 'failed';
        entry.error = 'Connection could not be recovered. Generate a new code.';
      }
    }
  });

  return entry;
}

async function restartSocket(number, entry) {
  if (!sessions.has(number) || entry.intentionalReset || entry.restarting) return;
  entry.restarting = true;
  try {
    try { entry.sock?.end?.(); } catch (_) {}
    await delay(250);
    entry.restarting = false;
    await createSocket(number, entry);
  } catch (e) {
    entry.restarting = false;
    entry.status = 'failed';
    entry.error = e.message;
  }
}

async function freshSocket(number) {
  const old = sessions.get(number);
  if (old) {
    old.intentionalReset = true;
    try { old.sock?.end?.(); } catch (_) {}
    sessions.delete(number);
  }
  const dir = sessionDir(number);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return createSocket(number);
}

const html = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Danish Khan WA Login</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#05060a;color:#fff;font-family:system-ui;text-align:center}
main{width:min(650px,92%);margin:35px auto}.tag{display:inline-block;padding:8px 14px;border:1px solid #394052;border-radius:99px;color:#cbd3e2;font-size:11px;font-weight:900;letter-spacing:.15em}
h1{font-size:clamp(36px,9vw,58px);line-height:1;margin:18px 0}.sub{color:#929daf}.card{margin-top:25px;padding:22px;border:1px solid #2b3342;border-radius:26px;background:#0b0e15}
.tabs,.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.tabs{margin-bottom:18px}button,input{width:100%;padding:16px;border-radius:14px;border:1px solid #354052;background:#151922;color:#fff;font-size:15px;font-weight:800}input{text-align:left;font-size:18px}.active,.primary{background:linear-gradient(135deg,#7047ff,#a16cff);border:0}
.box{margin-top:18px;padding:18px;border:1px dashed #465165;border-radius:16px}.code{font-size:32px;letter-spacing:.16em;font-weight:900;margin:8px}.qr{width:min(270px,85%);background:#fff;padding:8px;border-radius:10px;margin:10px}.status{margin-top:15px;padding:13px;background:#070a10;border-radius:12px;color:#b5bfd0}.good{color:#00e3a0}.bad{color:#ff6d87}.note{font-size:12px;color:#718097;margin-top:15px;line-height:1.5}@media(max-width:500px){.grid{grid-template-columns:1fr}.card{padding:18px}}
</style></head><body><main><span class="tag">DANISH KHAN • WA LOGIN</span><h1>WhatsApp Login</h1><div class="sub">QR + Pair Code</div>
<section class="card"><div class="tabs"><button id="qt" class="active">QR Login</button><button id="pt">Pair Code</button></div>
<div id="qv"><button id="qrgo" class="primary">Generate QR</button><div id="qb" class="box" hidden><b>SCAN WITH WHATSAPP</b><br><img id="qr" class="qr"></div></div>
<div id="pv" hidden><input id="num" inputmode="numeric" placeholder="Country code + number (digits only)"><br><br><button id="pc" class="primary">Generate Pair Code</button><div id="pb" class="box" hidden><small>PAIR CODE</small><div id="code" class="code"></div></div></div>
<div class="grid"><button id="check">Check Login</button><button id="reset">New Session</button></div>
<div id="st" class="status">Ready.</div><div class="note">Use your own WhatsApp account. After entering the code, keep this page open until it says LOGIN SUCCESS.</div></section></main>
<script>
let number="",timer;const $=x=>document.getElementById(x);const say=(t,c="")=>{$("st").className="status "+c;$('st').textContent=t};
function poll(){clearInterval(timer);timer=setInterval(async()=>{if(!number)return;try{const x=await(await fetch('/api/status?number='+encodeURIComponent(number))).json();if(x.status==='connected'){clearInterval(timer);say('LOGIN SUCCESS — WhatsApp linked.','good')}else if(x.status==='failed'||x.status==='logged_out'){clearInterval(timer);say(x.error||'Connection closed','bad')}else say(x.status==='reconnecting'?'WhatsApp is finishing login…':'Waiting for WhatsApp…')}catch(e){}},1500)}
$('qt').onclick=()=>{$('qv').hidden=false;$('pv').hidden=true;$('qt').className='active';$('pt').className=''};$('pt').onclick=()=>{$('qv').hidden=true;$('pv').hidden=false;$('pt').className='active';$('qt').className=''};
$('qrgo').onclick=async()=>{say('Starting QR login…');try{const x=await(await fetch('/api/qr',{method:'POST'})).json();if(!x.ok)throw Error(x.error);number=x.number;$('qr').src=x.qr;$('qb').hidden=false;say('WhatsApp → Linked devices → Link a device → Scan QR.','good');poll()}catch(e){say(e.message,'bad')}};
$('pc').onclick=async()=>{number=$('num').value.replace(/\\D/g,'');if(!/^\\d{7,15}$/.test(number))return say('Enter a valid number with country code, digits only.','bad');say('Generating pair code…');try{const x=await(await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number})})).json();if(!x.ok)throw Error(x.error);$('code').textContent=x.code.match(/.{1,4}/g)?.join('-')||x.code;$('pb').hidden=false;say('Enter this code in WhatsApp → Linked devices → Link with phone number.','good');poll()}catch(e){say(e.message,'bad')}};
$('check').onclick=async()=>{if(!number)return say('Start login first');const x=await(await fetch('/api/status?number='+encodeURIComponent(number))).json();say('Status: '+x.status+(x.credsSaved?' • session saved':''),x.status==='connected'?'good':'')};
$('reset').onclick=async()=>{if(number)await fetch('/api/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number})});clearInterval(timer);$('qb').hidden=true;$('pb').hidden=true;say('Fresh session ready.','good')};
</script></body></html>`;

app.get('/', (req, res) => res.type('html').send(html));
app.get('/health', (req, res) => res.json({ ok: true, service: 'whatsapp-login' }));

app.post('/api/pair', async (req, res) => {
  const number = digits(req.body?.number);
  if (!validNumber(number)) return res.status(400).json({ ok:false, error:'Invalid number. Use country code + number, digits only.' });
  try {
    const entry = await freshSocket(number);
    // Pairing code is requested only on a fresh, unregistered auth state.
    entry.pairingRequested = true;
    const code = await entry.sock.requestPairingCode(number);
    entry.code = code;
    entry.status = 'waiting_for_phone';
    res.json({ ok:true, number, code });
  } catch (e) {
    const entry = sessions.get(number);
    if (entry) { entry.status='failed'; entry.error=e.message; }
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post('/api/qr', async (req, res) => {
  const number = 'qr-' + Date.now();
  try {
    const entry = await freshSocket(number);
    for (let i=0; i<80 && !entry.qr; i++) await delay(250);
    if (!entry.qr) throw new Error(entry.error || 'QR not received; check Render logs.');
    res.json({ ok:true, number, qr:entry.qr });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.get('/api/status', (req, res) => {
  const raw = String(req.query.number || '');
  const key = raw.startsWith('qr-') ? raw : digits(raw);
  const entry = sessions.get(key);
  const saved = fs.existsSync(credsFile(key));
  res.json({ ok:true, status: entry?.status || (saved ? 'connected' : 'idle'), error:entry?.error||null, credsSaved:saved, connectedAt:entry?.connectedAt||null });
});

app.post('/api/reset', async (req, res) => {
  const raw = String(req.body?.number || '');
  const key = raw.startsWith('qr-') ? raw : digits(raw);
  const entry = sessions.get(key);
  if (entry) entry.intentionalReset = true;
  try { entry?.sock?.end?.(); } catch (_) {}
  sessions.delete(key);
  const dir = sessionDir(key);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive:true, force:true });
  res.json({ ok:true });
});

app.listen(PORT, '0.0.0.0', () => console.log('Danish Khan WA Login running on port ' + PORT));
