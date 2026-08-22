# Danish Khan WhatsApp Linker — Final

Render:
- Root Directory: blank
- Build: `npm install`
- Start: `npm start`

Files:
- package.json
- server.js

This version serves the UI from server.js, so there is no public/index.html path problem.

It supports:
1. Pairing code
2. QR fallback
3. Live login status
4. creds.json download after successful authentication
5. Fresh session/reset

Important:
- Use only with an account you own.
- No app can guarantee WhatsApp will accept every pairing request. Current Baileys reports show WhatsApp-side 408/515 pairing failures even with current versions.
- If Pair Code fails, use the QR fallback displayed by the app; QR and pairing code use different parts of the WhatsApp Web flow.
- Render free local disk is ephemeral. For long-term session persistence, attach persistent storage or use another appropriate storage layer.
- Never commit sessions/ or creds.json to GitHub.
