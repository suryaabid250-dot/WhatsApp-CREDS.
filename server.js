import express from 'express';
import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion
} from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 10000);
const SESSIONS = path.join(__dirname, 'sessions');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const jobs = new Map();
fs.mkdirSync(SESSIONS, { recursive: true });

const app = express();
app.use(express.json({ limit: '32kb' }));

const digits = v => String(v ?? '').replace(/\D/g, '');
const valid = n => /^\d{7,15}$/.test(n);
const dirFor = n => path.join(SESSIONS, n);
const credsFor = n => path.join(dirFor(n), 'creds.json');

async function getWaVersion() {
  try {
    const live = await fetchLatestWaWebVersion();
    if (Array.isArray(live?.version) && live.version.length === 3) {
      console.log('Using live WhatsApp Web version:', live.version.join('.'));
      return live.version;
    }
  } catch (e) {
    console.warn('Live WA Web version lookup failed:', e?.message || e);
  }
  return undefined;
}

function waitForQr(sock, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('WhatsApp socket did not become ready for pairing in time.'));
    }, timeoutMs);
    const onUpdate = update => {
      if (update.qr) {
        cleanup();
        resolve();
      }
      if (update.connection === 'close') {
        const code = update.lastDisconnect?.error?.output?.statusCode;
        cleanup();
        reject(new Error(`WhatsApp closed before pairing (status ${code ?? 'unknown'}).`));
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      sock.ev.off('connection.update', onUpdate);
    };
    sock.ev.on('connection.update', onUpdate);
  });
}

async function createPairJob(number) {
  const old = jobs.get(number);
  try { old?.sock?.end?.(); } catch {}
  jobs.delete(number);

  const dir = dirFor(number);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const version = await getWaVersion();
  const options = {
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    logger,
    // Canonical browser identity is important for phone-number pairing.
    browser: Browsers.macOS('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 20000
  };
  if (version) options.version = version;

  const sock = makeWASocket(options);
  const job = { sock, status: 'connecting', code: null, error: null, createdAt: Date.now() };
  jobs.set(number, job);
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', update => {
    const current = jobs.get(number);
    if (!current || current.sock !== sock) return;
    if (update.connection === 'open') {
      current.status = 'connected';
      current.error = null;
    } else if (update.connection === 'close') {
      const statusCode = update.lastDisconnect?.error?.output?.statusCode;
      current.status = statusCode === DisconnectReason.loggedOut ? 'logged_out' : 'closed';
      current.error = `WhatsApp connection closed (${statusCode ?? 'unknown'})`;
      console.error(current.error);
    }
  });

  await waitForQr(sock);
  return { sock, state };
}

async function generatePairCode(number) {
  const { sock } = await createPairJob(number);
  const job = jobs.get(number);
  const code = await sock.requestPairingCode(number);
  if (job) job.code = code;
  return code;
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'Danish Khan PairCode v3' }));

app.post('/api/pair', async (req, res) => {
  const number = digits(req.body?.number);
  if (!valid(number)) return res.status(400).json({ ok: false, error: 'Invalid number. Use 7–15 digits with country code.' });
  try {
    const code = await generatePairCode(number);
    res.json({ ok: true, code });
  } catch (e) {
    console.error('PAIR_ERROR:', e);
    res.status(502).json({ ok: false, error: e?.message || 'WhatsApp pairing failed.' });
  }
});

app.get('/api/status', (req, res) => {
  const number = digits(req.query.number);
  if (!valid(number)) return res.status(400).json({ ok: false, error: 'Invalid number.' });
  const job = jobs.get(number);
  let registered = false;
  const file = credsFor(number);
  if (fs.existsSync(file)) {
    try { registered = !!JSON.parse(fs.readFileSync(file, 'utf8')).registered; } catch {}
  }
  res.json({ ok: true, status: registered ? 'connected' : (job?.status || 'idle'), error: job?.error || null, credsSaved: fs.existsSync(file) });
});

app.post('/api/reset', (req, res) => {
  const number = digits(req.body?.number);
  if (!valid(number)) return res.status(400).json({ ok: false, error: 'Invalid number.' });
  try { jobs.get(number)?.sock?.end?.(); } catch {}
  jobs.delete(number);
  fs.rmSync(dirFor(number), { recursive: true, force: true });
  res.json({ ok: true });
});

app.get('/api/download', (req, res) => {
  const number = digits(req.query.number);
  if (!valid(number)) return res.status(400).send('Invalid number.');
  const file = credsFor(number);
  if (!fs.existsSync(file)) return res.status(404).send('creds.json is not available yet. Complete linking first.');
  res.download(file, 'creds.json');
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Danish Khan • WhatsApp Pair Code</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#fff;background:#05060a}body:before{content:"";position:fixed;inset:-30%;z-index:-2;background:radial-gradient(circle at 15% 15%,#6d28d9 0,transparent 24%),radial-gradient(circle at 85% 20%,#0369a1 0,transparent 24%),radial-gradient(circle at 70% 85%,#047857 0,transparent 24%);filter:blur(55px)}body:after{content:"";position:fixed;inset:0;z-index:-1;background:#05060ae8}.wrap{width:min(720px,92%);margin:42px auto 60px}.head{text-align:center}.tag{display:inline-block;padding:8px 13px;border:1px solid #343b4c;border-radius:999px;background:#0d1018;color:#bdc5d6;font-size:11px;font-weight:900;letter-spacing:.15em}h1{font-size:clamp(36px,9vw,62px);line-height:1;margin:17px 0 7px;letter-spacing:-.055em}.sub{color:#929caf}.card{margin-top:28px;padding:26px;border:1px solid #2a3242;border-radius:28px;background:#0b0e15f0;box-shadow:0 35px 100px #000b;backdrop-filter:blur(18px)}label{display:block;font-weight:850;margin-bottom:9px}input{width:100%;padding:17px;border-radius:15px;border:1px solid #353e50;background:#07090e;color:#fff;font-size:18px;outline:0}input:focus{border-color:#8b5cf6}.hint{font-size:12px;color:#7f8a9e;margin:8px 0 18px}button{width:100%;padding:16px;border-radius:15px;border:1px solid #30394a;background:#171b24;color:#fff;font-size:15px;font-weight:900;cursor:pointer}.primary{border:0;background:linear-gradient(135deg,#6d45ff,#a06cff);box-shadow:0 16px 45px #704cff38}.primary:disabled{opacity:.55}.code{margin-top:20px;padding:22px;text-align:center;border:1px dashed #465165;border-radius:18px;background:#070a10}.code small{color:#8994a8}.code b{display:block;margin-top:9px;font-size:34px;letter-spacing:.17em}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.status{margin-top:16px;padding:14px;border-radius:14px;background:#070a10;color:#aeb8c9;font-size:14px}.good{color:#00e3a0}.bad{color:#ff6b86}.note{margin-top:16px;color:#68758a;font-size:12px;line-height:1.6}@media(max-width:520px){.card{padding:20px}.grid{grid-template-columns:1fr}.code b{font-size:27px}}
</style></head><body><div class="wrap"><div class="head"><span class="tag">DANISH KHAN • WA LINKER</span><h1>WhatsApp Pair Code</h1><div class="sub">Fresh session • live WhatsApp Web version</div></div><div class="card"><label>WhatsApp number</label><input id="number" inputmode="numeric" value="917050407246"><div class="hint">Country code included. Digits only — no +, spaces or dashes.</div><button class="primary" id="gen">Generate Pair Code</button><div class="code" id="box" hidden><small>PAIR CODE</small><b id="code">--------</b></div><div class="grid"><button id="copy">Copy Code</button><button id="check">Check Status</button></div><div class="grid"><button id="download">Download creds.json</button><button id="reset">New Session</button></div><div class="status" id="status">Ready.</div><div class="note">Use only with a WhatsApp account you own. Never share creds.json or session files.</div></div></div>
<script>const $=id=>document.getElementById(id);let last='';const num=()=>$('number').value.replace(/\\D/g,'');function say(t,c=''){ $('status').className='status '+c; $('status').textContent=t }$('gen').onclick=async()=>{const n=num();if(!/^\\d{7,15}$/.test(n))return say('Enter 7–15 digits including country code.','bad');$('gen').disabled=true;say('Connecting to WhatsApp and requesting a fresh code…');try{const r=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number:n})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Pairing failed');last=d.code;$('code').textContent=d.code.replace(/(.{4})/,'$1-');$('box').hidden=false;say('Code generated. Enter it immediately in WhatsApp → Linked devices → Link with phone number.','good')}catch(e){say(e.message,'bad')}finally{$('gen').disabled=false}};$('copy').onclick=async()=>{if(!last)return say('Generate a code first.');await navigator.clipboard.writeText(last);say('Pair code copied.','good')};$('check').onclick=async()=>{const n=num();try{const d=await(await fetch('/api/status?number='+encodeURIComponent(n))).json();say('Status: '+d.status+(d.error?' • '+d.error:'')+(d.credsSaved?' • creds.json saved':''),d.status==='connected'?'good':'')}catch{say('Status check failed.','bad')}};$('download').onclick=()=>location.href='/api/download?number='+encodeURIComponent(num());$('reset').onclick=async()=>{const n=num();await fetch('/api/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number:n})});$('box').hidden=true;last='';say('Session cleared. Generate a fresh code.','good')};</script></body></html>`);
});

app.listen(PORT, '0.0.0.0', () => console.log(`DANISH KHAN PAIRCODE v3 running on port ${PORT}`));
