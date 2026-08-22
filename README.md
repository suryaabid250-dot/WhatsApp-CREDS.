# Danish Khan PairCode v2 — Render

Files:
- package.json
- server.js

Render:
- Runtime: Node
- Root Directory: blank
- Build Command: npm install
- Start Command: npm start

This version avoids the previous public/index.html path problem: the UI is served directly by server.js.

The pairing implementation follows the documented Baileys pairing-code flow, uses a cacheable signal key store, a canonical desktop browser profile, waits briefly for the socket on cloud hosts, and creates a fresh session for each new pairing attempt.

Important:
- No implementation can honestly guarantee 100% acceptance by WhatsApp. WhatsApp can reject pairing and Baileys can encounter protocol errors.
- Pairing code must be entered promptly and the number must include country code, digits only.
- creds.json and session keys are sensitive authentication material. Do not upload them to GitHub or share them.
- Render free instances have ephemeral local storage; if the service restarts/redeploys, local session files can be lost unless persistent storage is used.
