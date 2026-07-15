# AGENTS.md

## Cursor Cloud specific instructions

MinutesFlow AI is a single-service app: an Express server (`server.ts`) that also
mounts Vite in middleware mode to serve the React frontend (`src/`). One process
serves both the API and the UI.

### Run / build / lint / test
- Dev server: `npm run dev` (`tsx server.ts`), listens on `http://localhost:3000`
  (override with `PORT`). Serves API + Vite dev middleware.
- Lint (typecheck): `npm run lint` (`tsc --noEmit`).
- Build: `npm run build` (Vite build + esbuild server bundle into `dist/`); run
  the bundle with `npm start`. Not needed for development.
- There are no automated tests (no `test` script).

### Running locally without cloud credentials (important gotchas)
The server integrates Firebase Admin, Stripe, and Gemini, but is designed to run
fully offline in a local/sandbox mode. Two non-obvious env settings are required
for a clean local run (this project has no committed `.env`; `.env*` is gitignored):

- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` — Without this, `firebase-admin` tries
  to load Google Application Default Credentials, and on a machine with no GCP
  creds it throws an *uncaught* rejection that crashes the process on boot. Setting
  this env var makes Firestore skip ADC loading; the connection test then fails
  fast (nothing is listening on 8080) and the server transparently falls back to
  local JSON storage at `uploads/local_db.json`. Any host:port with nothing
  listening works; the value does not need a real emulator.
- `STRIPE_PRICE_1_CREDIT`, `STRIPE_PRICE_5_CREDITS`, `STRIPE_PRICE_10_CREDITS` —
  Must be set (any placeholder string) or the buy-credits endpoint returns
  "Stripe price not configured" before it can reach the simulated checkout. Leave
  `STRIPE_SECRET_KEY` empty to run in simulated sandbox payment mode.
- `GEMINI_API_KEY` — Only required for real audio transcription / minutes
  generation. The rest of the app (auth, dashboard, credit purchase) runs without it.

Recommended one-line dev command (self-contained, no `.env` needed):
```
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 STRIPE_PRICE_1_CREDIT=price_dev STRIPE_PRICE_5_CREDITS=price_dev STRIPE_PRICE_10_CREDITS=price_dev npm run dev
```
(`dotenv` loads a local `.env` if present, so equivalent values can live there instead.)

### Testing the app without Google/Stripe/Gemini
- On the landing page click **"Explore in Local Sandbox Mode"** to sign in without
  Google (dev-only bypass user `sandbox_user_123`).
- Credit purchases use a simulated "Sandbox Checkout" (test card `4242 4242 4242 4242`,
  any future expiry, any CVC); credits persist to `uploads/local_db.json`.
- `uploads/local_db.json` is the local fallback DB and already contains demo data.
