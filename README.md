# Danish Khan WhatsApp Pair Code — Render

This version intentionally uses **one server file** to avoid the previous `public/index.html` path error.

Files:
- `package.json`
- `server.js`

Render settings:
- Root Directory: blank
- Build Command: `npm install`
- Start Command: `npm start`

After deploy, open the Render **service URL**.

Health check:
`https://YOUR-SERVICE.onrender.com/health`

The app stores authentication state under `sessions/<number>/`. Do NOT commit or share this folder.

Pairing code support is provided by Baileys. WhatsApp/Baileys pairing can fail independently of the web server if WhatsApp changes or rejects the pairing flow.
