# Deploy to Firebase App Hosting

Step-by-step guide for deploying **meeting-minutes-recorder-and-translator** to Firebase App Hosting.

**Project ID:** `gen-lang-client-0135145658`  
**Stripe Price ID:** `price_1TrpGLBH4tcxHv5Eyuqx1pJw`  
**Stripe Product ID:** `prod_Uq9DBX2LStZqUi`  
**Stripe webhook endpoint:** `https://<your-app-hosting-url>/api/stripe/webhook`

---

## Prerequisites

1. **Blaze (pay-as-you-go) plan** on the Firebase project (required for App Hosting).
2. **Node.js 20+** installed locally.
3. **Firebase CLI 14.4.0+**:
   ```powershell
   npm install -g firebase-tools
   ```
   Or use `npx firebase-tools@latest` for one-off commands (no global install).
4. **Google account** with Owner or App Hosting Admin on the Firebase project.

---

## 1. Install dependencies and verify build

```powershell
cd C:\Users\user\Downloads\meeting-minutes-recorder-and-translator
npm install
npm run build
```

Expected output: Vite builds `dist/` and esbuild bundles `dist/server.cjs`.

---

## 2. Authenticate with Firebase

```powershell
firebase login
```

Verify the active account:

```powershell
firebase login:list
```

Set the default project (already configured in `.firebaserc`):

```powershell
firebase use gen-lang-client-0135145658
```

---

## 3. Create or link an App Hosting backend

### Option A — First-time setup (interactive)

```powershell
firebase init apphosting
```

When prompted:

| Prompt | Recommended choice |
|--------|-------------------|
| Project | `gen-lang-client-0135145658` |
| Backend | **Link to existing** `studio` if migrating from AI Studio, or **Create new** (e.g. `meeting-minutes`) |
| Region | `us-central1` (or your preferred region) |
| Root directory | `.` |
| Node.js runtime | Latest LTS (e.g. `nodejs22`) |

This updates `firebase.json` with your `backendId`. The repo is preconfigured with `backendId: "studio"` for AI Studio migrations.

### Option B — List existing backends

```powershell
firebase apphosting:backends:list --project gen-lang-client-0135145658
```

If your backend ID differs from `studio`, edit `firebase.json` → `apphosting[0].backendId`.

---

## 4. Set environment variables and secrets

**Never commit secrets.** Configure them in Firebase Console or via CLI.

### Required secrets (Cloud Secret Manager)

Create each secret (CLI will prompt for the value):

```powershell
firebase apphosting:secrets:set GEMINI_API_KEY --project gen-lang-client-0135145658
firebase apphosting:secrets:set STRIPE_SECRET_KEY --project gen-lang-client-0135145658
firebase apphosting:secrets:set STRIPE_WEBHOOK_SECRET --project gen-lang-client-0135145658
```

`apphosting.yaml` already references these secret names.

### Non-secret variables (in `apphosting.yaml` or Console)

| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_ENV` | `production` | Set in `apphosting.yaml` |
| `STRIPE_CREDIT_PRICE_ID` | `price_1TrpGLBH4tcxHv5Eyuqx1pJw` | Set in `apphosting.yaml` |
| `STRIPE_PRODUCT_ID` | `prod_Uq9DBX2LStZqUi` | Set in `apphosting.yaml` |
| `APP_URL` | Your App Hosting URL | **Update after first deploy** (see step 6) |

### Set via Firebase Console

1. Open [Firebase Console](https://console.firebase.google.com/) → **Hosting & Serverless** → **App Hosting**.
2. Select your backend → **Settings** → **Environment**.
3. Add secrets and variables. Console values override `apphosting.yaml`.

---

## 5. Deploy

Deploy only App Hosting (avoids conflicting legacy Hosting config):

```powershell
firebase deploy --only apphosting:studio --project gen-lang-client-0135145658
```

If your backend ID is different:

```powershell
firebase deploy --only apphosting:<YOUR_BACKEND_ID> --project gen-lang-client-0135145658
```

Deploy everything (App Hosting + Firestore rules):

```powershell
firebase deploy --project gen-lang-client-0135145658
```

First deploy may take 5–15 minutes (Cloud Build + Cloud Run rollout).

---

## 6. Set `APP_URL` after first deploy

1. In Firebase Console → App Hosting → your backend, copy the live URL.  
   Example format: `https://studio--gen-lang-client-0135145658.us-central1.hosted.app`

2. Update `APP_URL`:

   **Console:** Settings → Environment → set `APP_URL` to the live URL.

   **Or edit `apphosting.yaml`:**
   ```yaml
   - variable: APP_URL
     value: https://studio--gen-lang-client-0135145658.us-central1.hosted.app
   ```

3. Redeploy:
   ```powershell
   firebase deploy --only apphosting:studio --project gen-lang-client-0135145658
   ```

`APP_URL` is used for Stripe checkout success/cancel redirects.

---

## 6b. Custom domain (Firebase App Hosting)

**Domain:** `minutesflow.com` (apex primary). Optionally also connect `www.minutesflow.com` and redirect www → apex.

Custom domains are configured in the **Firebase Console** (Firebase CLI has no `apphosting` custom-domain add command today). Backend: **`meeting-minutes`**.

### A. Own the domain

1. Confirm you own `minutesflow.com` and can edit DNS at your registrar (Namecheap, Cloudflare, GoDaddy, Squarespace Domains, etc.).
2. **Primary hostname:** apex `minutesflow.com` → `https://minutesflow.com` (this is what `APP_URL` uses).
3. **Optional:** add `www.minutesflow.com` in App Hosting and choose redirect to the apex so both work; Auth should list both hostnames if www is live.

### B. Add the domain in App Hosting

1. Open [Firebase Console](https://console.firebase.google.com/project/gen-lang-client-0135145658/apphosting) → **App Hosting**.
2. Open backend **`meeting-minutes`** → **Settings** → **Add custom domain**.
3. Enter `minutesflow.com` (no `https://`) and follow the wizard.
4. Optionally add `www.minutesflow.com` and set redirect → `minutesflow.com`.
5. Firebase shows the DNS records to create. Copy them exactly — typically:
   - **Apex (`minutesflow.com`):** **A** record(s) to App Hosting IPs; often a **TXT** claim (`fah-claim=…`); sometimes a **CNAME** on `_acme-challenge…` for SSL.
   - **www:** usually a **CNAME** (subdomains cannot use apex A-only the same way).
   - App Hosting may ask you to **remove** existing **AAAA** / conflicting **A** or **CNAME** records pointing elsewhere — conflicting records block SSL.

Docs: [Connect a custom domain](https://firebase.google.com/docs/app-hosting/custom-domain)

### C. Update DNS at your registrar

1. In your DNS provider, add (and remove) the records Firebase displayed for `minutesflow.com` (and www if used). Host field is often `@` for apex and `www` for the subdomain (Namecheap / Cloudflare / Squarespace).
2. Wait for DNS propagation (often minutes; can take up to 24–48 hours). SSL can take additional hours after DNS is correct.
3. In the Firebase Console, wait until status is **Connected** (not Needs setup / Pending / Minting Certificate).

### D. Firebase Auth authorized domains

1. Firebase Console → **Authentication** → **Settings** → **Authorized domains**.
2. Add `minutesflow.com` (and `www.minutesflow.com` if you connected www) **without** `https://`.
3. Keep the existing `*.hosted.app` / default domains so the old URL still works during cutover.

### E. Update `APP_URL` and Stripe

Stripe checkout success/cancel URLs and the webhook use absolute URLs. `apphosting.yaml` is already set to `https://minutesflow.com`.

1. After the custom domain is connected (or when you cut over), redeploy App Hosting so runtime `APP_URL` is live:
   ```powershell
   firebase deploy --only apphosting:meeting-minutes --project gen-lang-client-0135145658
   ```
2. Stripe Dashboard → **Webhooks** → set endpoint to:
   `https://minutesflow.com/api/stripe/webhook`
3. If Stripe issues a new signing secret, update `STRIPE_WEBHOOK_SECRET` and redeploy.

### F. Verify

```powershell
curl https://minutesflow.com/api/health
curl https://minutesflow.com/api/stripe/config
```

Test Google Sign-In and a credit purchase on `https://minutesflow.com`.

**Reminder:** You must own `minutesflow.com` and control its DNS at your registrar before steps B–C can complete.

---

## 7. Configure Stripe webhook

1. [Stripe Dashboard](https://dashboard.stripe.com/webhooks) → **Add endpoint**.
2. **Endpoint URL:** `https://minutesflow.com/api/stripe/webhook`  
   (Until the custom domain is live, you may temporarily use  
   `https://meeting-minutes--gen-lang-client-0135145658.asia-southeast1.hosted.app/api/stripe/webhook`.)
3. **Events:** at minimum `checkout.session.completed`
4. Copy the **Signing secret** (`whsec_...`).
5. Store it:
   ```powershell
   firebase apphosting:secrets:set STRIPE_WEBHOOK_SECRET --project gen-lang-client-0135145658
   ```
6. Redeploy so the new secret is picked up.

---

## 8. Verify deployment

```powershell
# Health check
curl https://<your-app-hosting-url>/api/health

# Stripe config (should show configured: true when STRIPE_SECRET_KEY is set)
curl https://<your-app-hosting-url>/api/stripe/config
```

Open the app URL in a browser and test sign-in, recording, and checkout.

---

## Configuration files reference

| File | Purpose |
|------|---------|
| `apphosting.yaml` | Build/run commands, Cloud Run resources, env vars & secrets |
| `firebase.json` | App Hosting backend ID, root dir, deploy ignore list |
| `.firebaserc` | Default Firebase project (`gen-lang-client-0135145658`) |
| `firebase-applet-config.json` | Firebase client config (committed; not a secret) |
| `package.json` | `build` → Vite + server bundle; `start` → `node dist/server.cjs` |

### Build & run (App Hosting)

- **Build:** `npm run build` — Vite frontend + esbuild server bundle
- **Start:** `npm start` — Express serves API + static `dist/` in production
- **Port:** Server listens on `process.env.PORT` (injected by Cloud Run)

### Cloud Run resources (`apphosting.yaml`)

- 2 vCPU, 4096 MiB RAM (audio/Gemini workloads)
- minInstances 1 + cpuAlwaysAllocated (keeps one warm instance; avoids cold starts)
- Concurrency 10 (long-running transcription requests)

---

## Troubleshooting

### Firebase CLI not found

```powershell
npm install -g firebase-tools
# or
npx firebase-tools@latest deploy --only apphosting:studio
```

### Not authenticated

```powershell
firebase login
firebase login:ci   # for CI/CD only
```

### Blaze plan required

Upgrade the project in Firebase Console → **Usage and billing** → **Modify plan**.

### Build fails on Cloud Build

- Confirm `npm run build` works locally.
- Check Cloud Build logs in Firebase Console → App Hosting → Rollouts.

### `APP_URL` / Stripe redirects wrong

Ensure `APP_URL` matches the live App Hosting URL exactly (no trailing slash).

### ffmpeg not available

The server falls back to original audio if `ffmpeg` is missing on Cloud Run. Transcoding may be less reliable; consider a custom container if ffmpeg is required.

### Firestore permission errors

Server uses **Firebase Admin SDK** (not client rules). Ensure the App Hosting service account has Firestore access in Google Cloud IAM.

---

## Quick command checklist

```powershell
cd C:\Users\user\Downloads\meeting-minutes-recorder-and-translator
npm install
npm run build
firebase login
firebase use gen-lang-client-0135145658
firebase apphosting:secrets:set GEMINI_API_KEY
firebase apphosting:secrets:set STRIPE_SECRET_KEY
firebase apphosting:secrets:set STRIPE_WEBHOOK_SECRET
firebase deploy --only apphosting:studio --project gen-lang-client-0135145658
# → Copy live URL, set APP_URL, configure Stripe webhook, redeploy
firebase deploy --only apphosting:studio --project gen-lang-client-0135145658
```

---

## GitHub CI/CD (optional)

For automatic deploys on push:

1. Firebase Console → App Hosting → backend → **Deployment** → **Connect to GitHub**
2. Select repo, branch (`main`), root directory `/`
3. Environment variables/secrets still managed in Console or `apphosting.yaml`

Local `firebase deploy` and GitHub rollouts use the same build process.
