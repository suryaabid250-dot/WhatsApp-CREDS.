# Danish Khan WhatsApp PairCode v3

## Render
- Root Directory: blank
- Build Command: `npm install`
- Start Command: `npm start`
- Environment: Node 20+

## Files
- `package.json`
- `server.js`
- `README.md`

The app serves the UI directly from `server.js`. No `public` folder is required.

This version uses Baileys 7.0.0-rc13, a canonical Chrome/macOS browser profile, waits for the pairing-ready QR handshake before requesting the code, and attempts to resolve the live WhatsApp Web client revision. A `sessions/<number>/creds.json` file is saved after successful linking.

Only use it with a WhatsApp account you own. WhatsApp can still reject a pairing request for server-side, rate-limit, account, network, or protocol reasons; no third-party script can guarantee acceptance.
