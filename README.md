# Danish Khan WhatsApp Login v6

Render settings:
- Build Command: `npm install`
- Start Command: `npm start`
- Root Directory: blank
- Node: 20+

## Important fix
This build uses the live WhatsApp Web client revision (`fetchLatestWaWebVersion`) before creating the Baileys socket, with a fallback to the Baileys version helper. This avoids the stale-Web-version pairing failures that can generate a code but leave the phone stuck on “Couldn't link device”.

It also:
- keeps the auth files after pairing;
- restarts the socket after Baileys reports a new login;
- reconnects transient disconnects without deleting credentials;
- saves credentials through `creds.update`;
- provides QR as a fallback;
- exposes `/health` for Render.

Use only your own WhatsApp account. WhatsApp can change server-side pairing rules, so no unofficial WhatsApp Web library can honestly guarantee 100% availability.
