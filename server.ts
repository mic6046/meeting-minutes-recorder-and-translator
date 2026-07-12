import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { execSync } from "child_process";
import Stripe from "stripe";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import type { Request, Response, NextFunction } from "express";

dotenv.config();

import { Agent, setGlobalDispatcher } from "undici";

// Configure undici's global dispatcher to support long-running fetch requests (e.g. Gemini audio transcribing/minutes generation up to 10 minutes)
setGlobalDispatcher(
  new Agent({
    headersTimeout: 600000, // 10 minutes
    bodyTimeout: 600000,    // 10 minutes
    connectTimeout: 60000,  // 1 minute
  })
);

// Ensure uploads folder exists
if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads", { recursive: true });
}

// Initialize Firebase Admin with project ID from config
const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
let fdb: Firestore | null = null;
let isUsingFallbackDb = false;

const LOCAL_DB_PATH = path.join(process.cwd(), "uploads", "local_db.json");

interface LocalDbSchema {
  users: Record<string, any>;
  meetings: Record<string, any>;
  payments: Record<string, any>;
}

function loadLocalDb(): LocalDbSchema {
  if (fs.existsSync(LOCAL_DB_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(LOCAL_DB_PATH, "utf8"));
    } catch (e) {
      console.error("❌ Error reading local DB file, initializing empty:", e);
    }
  }
  return { users: {}, meetings: {}, payments: {} };
}

function saveLocalDb(data: LocalDbSchema) {
  try {
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("❌ Error writing to local DB file:", e);
  }
}

if (fs.existsSync(firebaseConfigPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8"));
    let app;
    if (getApps().length === 0) {
      app = initializeApp({
        projectId: config.projectId,
      });
    } else {
      app = getApps()[0];
    }
    if (config.firestoreDatabaseId) {
      fdb = getFirestore(app, config.firestoreDatabaseId);
      console.log("🔥 Firebase Admin successfully initialized on server with project:", config.projectId, "and database:", config.firestoreDatabaseId);
    } else {
      fdb = getFirestore(app);
      console.log("🔥 Firebase Admin successfully initialized on server with project:", config.projectId, "(default database)");
    }
  } catch (err) {
    console.error("❌ Error initializing Firebase Admin on server:", err);
  }
}

// Synchronously verify connection to Firestore to determine if we need fallback
async function verifyDbConnection() {
  if (fdb) {
    try {
      // Test read to see if we have permissions
      await fdb.collection("users").limit(1).get();
      console.log("✅ Cloud Firestore connection verified. Server is operating with cloud persistence.");
      isUsingFallbackDb = false;
    } catch (err: any) {
      console.warn("⚠️ Firestore access test failed (likely permission denied or API disabled):", err.message);
      console.warn("⚠️ Server will transparently use persistent local JSON-based fallback storage inside uploads/local_db.json.");
      isUsingFallbackDb = true;
    }
  } else {
    console.warn("⚠️ Firebase Admin is not initialized. Falling back to local file storage.");
    isUsingFallbackDb = true;
  }
}

// Fire-and-forget the check on boot
verifyDbConnection();

const CREDIT_PRICE_SEN = 3900; // RM39.00 per credit
// Hardcoded at every Gemini call site too — do not rely solely on this constant.
const GEMINI_MODEL = "gemini-3.5-flash";
const MIN_AUDIO_BYTES = 4096;
const isProduction = process.env.NODE_ENV === "production";

function isNoSpeechResult(transcript?: string, minutes?: string): boolean {
  const blob = `${transcript || ""}\n${minutes || ""}`.toLowerCase();
  return (
    blob.includes("no intelligible speech") ||
    blob.includes("no speech detected") ||
    blob.includes("### no speech detected")
  );
}

function readBuildMeta(): { buildId?: string; builtAt?: string } {
  try {
    const candidates = [
      path.join(path.dirname(process.argv[1] || ""), "version.json"),
      path.join(process.cwd(), "dist", "version.json"),
      path.join(process.cwd(), "version.json"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, "utf8"));
      }
    }
  } catch {
    // ignore
  }
  return {};
}

function formatGeminiError(err: any, modelUsed: string): string {
  const raw = err?.message || String(err);
  return `Gemini model "${modelUsed}" failed: ${raw}`;
}

interface AuthedRequest extends Request {
  authedUid?: string;
}

function getClaimedUserId(req: Request): string | undefined {
  const fromBody = (req.body as { userId?: string } | undefined)?.userId;
  const fromQuery = req.query.userId as string | undefined;
  const fromHeader = req.headers["x-user-id"] as string | undefined;
  return fromBody || fromQuery || fromHeader;
}

async function verifyFirebaseAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const claimedUserId = getClaimedUserId(req);

  // Dev-only sandbox bypass for local preview without Firebase Auth
  if (!isProduction && claimedUserId === "sandbox_user_123") {
    req.authedUid = "sandbox_user_123";
    return next();
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized", message: "Missing authentication token." });
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    req.authedUid = decoded.uid;
    next();
  } catch (err: any) {
    console.error("Firebase token verification failed:", err.message);
    return res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token." });
  }
}

function requireUserMatch(req: AuthedRequest, res: Response, next: NextFunction) {
  const claimedUserId = getClaimedUserId(req);
  if (claimedUserId && req.authedUid && claimedUserId !== req.authedUid) {
    return res.status(403).json({ error: "Forbidden", message: "User ID does not match authenticated session." });
  }
  next();
}

const CREDIT_PACKAGES = {
  credits_1: { credits: 1, priceSen: 3900, envVar: "STRIPE_PRICE_1_CREDIT" },
  credits_5: { credits: 5, priceSen: 19500, envVar: "STRIPE_PRICE_5_CREDITS" },
  credits_10: { credits: 10, priceSen: 39000, envVar: "STRIPE_PRICE_10_CREDITS" },
} as const;

type PackageId = keyof typeof CREDIT_PACKAGES;

function creditsToPackageId(credits: number): PackageId | null {
  if (credits === 1) return "credits_1";
  if (credits === 5) return "credits_5";
  if (credits === 10) return "credits_10";
  return null;
}

function resolvePackage(input: { packageId?: string; credits?: unknown }): {
  packageId: PackageId;
  credits: number;
  priceId: string;
  priceSen: number;
} {
  let packageId: PackageId | null = null;

  if (input.packageId && input.packageId in CREDIT_PACKAGES) {
    packageId = input.packageId as PackageId;
  } else {
    const credits = parseInt(String(input.credits ?? ""), 10);
    packageId = creditsToPackageId(credits);
  }

  if (!packageId) {
    throw new Error("Invalid package. Choose credits_1, credits_5, or credits_10 (1, 5, or 10 credits).");
  }

  const pkg = CREDIT_PACKAGES[packageId];
  const priceId = process.env[pkg.envVar]?.trim();
  if (!priceId) {
    throw new Error(`Stripe price not configured. Set ${pkg.envVar}.`);
  }

  return { packageId, credits: pkg.credits, priceId, priceSen: pkg.priceSen };
}

function parseCreditQuantity(raw: unknown): number {
  const qty = parseInt(String(raw ?? "1"), 10);
  if (!Number.isFinite(qty) || qty < 1) return 1;
  return Math.min(qty, 100);
}

async function creditPurchaseAmount(credits: number): Promise<number> {
  const packageId = creditsToPackageId(credits);
  if (packageId) {
    return CREDIT_PACKAGES[packageId].priceSen;
  }
  return credits * CREDIT_PRICE_SEN;
}

// Database helper functions
async function getUserProfile(userId: string) {
  if (isUsingFallbackDb) {
    const db = loadLocalDb();
    return db.users[userId] || null;
  }
  if (!fdb) return null;
  const userRef = fdb.collection("users").doc(userId);
  const doc = await userRef.get();
  if (!doc.exists) {
    return null;
  }
  return doc.data();
}

async function ensureUserProfileExists(userId: string, email: string, displayName?: string, photoURL?: string) {
  if (isUsingFallbackDb) {
    const db = loadLocalDb();
    if (!db.users[userId]) {
      const initialUser = {
        id: userId,
        email: email || "",
        displayName: displayName || "",
        photoURL: photoURL || "",
        meetingCredits: 0,
        freeMinutesUsed: 0,
        stripeCustomerId: "",
        stripeSubscriptionId: "",
        subscriptionStatus: "none",
        accountType: "free",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.users[userId] = initialUser;
      saveLocalDb(db);
      return initialUser;
    }
    return db.users[userId];
  }
  if (!fdb) return null;
  const userRef = fdb.collection("users").doc(userId);
  const doc = await userRef.get();
  if (!doc.exists) {
    const initialUser = {
      id: userId,
      email: email || "",
      displayName: displayName || "",
      photoURL: photoURL || "",
      meetingCredits: 0,
      freeMinutesUsed: 0,
      stripeCustomerId: "",
      stripeSubscriptionId: "",
      subscriptionStatus: "none",
      accountType: "free",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
    await userRef.set(initialUser);
    return initialUser;
  }
  return doc.data();
}

async function deductCredit(userId: string): Promise<boolean> {
  if (isUsingFallbackDb) {
    const db = loadLocalDb();
    const user = db.users[userId];
    if (!user) return false;
    const currentCredits = user.meetingCredits || 0;
    if (currentCredits <= 0) {
      return false;
    }
    user.meetingCredits = currentCredits - 1;
    user.accountType = user.meetingCredits > 0 ? "paid" : "free";
    user.updatedAt = new Date().toISOString();
    saveLocalDb(db);
    return true;
  }
  if (!fdb) return true; // Fallback to true if database is unavailable to avoid user lockout
  const userRef = fdb.collection("users").doc(userId);
  
  try {
    return await fdb.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new Error("User profile not found");
      }
      const data = userDoc.data();
      const currentCredits = data?.meetingCredits || 0;
      if (currentCredits <= 0) {
        return false;
      }
      
      transaction.update(userRef, {
        meetingCredits: currentCredits - 1,
        accountType: currentCredits - 1 > 0 ? "paid" : "free",
        updatedAt: FieldValue.serverTimestamp()
      });
      return true;
    });
  } catch (err) {
    console.error("Credit deduction transaction failed:", err);
    return false;
  }
}

async function saveMeetingToDb(meetingData: {
  userId: string;
  title: string;
  duration: number;
  language: string;
  summary: string;
  minutes: string;
  actionItems: string;
  status: string;
  googleDoc?: any;
}) {
  const meetingId = `meeting_${Date.now()}`;
  const data = {
    id: meetingId,
    ...meetingData,
    createdAt: isUsingFallbackDb ? new Date().toISOString() : FieldValue.serverTimestamp()
  };

  if (isUsingFallbackDb) {
    const db = loadLocalDb();
    db.meetings[meetingId] = data;
    saveLocalDb(db);
    return data;
  }

  if (!fdb) return null;
  const meetingRef = fdb.collection("meetings").doc(meetingId);
  await meetingRef.set(data);
  return data;
}

// Transcode raw audio files to standard compressed mp3 using ffmpeg
function transcodeToMp3(inputPath: string, outputPath: string): boolean {
  try {
    console.log(`Transcoding audio file from ${inputPath} to ${outputPath}...`);
    // Convert to a clean mono 16kHz mp3, highly compressed.
    // We capture output to allow checking if partial audio files were created.
    try {
      execSync(`ffmpeg -y -i "${inputPath}" -vn -ar 16000 -ac 1 -b:a 64k "${outputPath}"`, {
        stdio: "pipe",
      });
    } catch (execErr: any) {
      console.warn("ffmpeg returned non-zero or warning, checking if output file was created:", execErr.message);
    }
    
    // Check if the output file exists and has valid size
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      console.log(`Transcoding completed. Size: ${fs.statSync(outputPath).size} bytes`);
      return true;
    }
    return false;
  } catch (error) {
    console.error("Transcoding failed with ffmpeg:", error);
    return false;
  }
}

// Initialize Gemini Client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Robust retry utility for handling temporary 503 errors and high-demand errors from the Gemini API
async function callWithRetry<T>(fn: () => Promise<T>, retries = 4, delayMs = 2000): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const errorMessage = error?.message || "";
      const isUnavailable = 
        errorMessage.includes("503") || 
        errorMessage.includes("UNAVAILABLE") || 
        errorMessage.includes("high demand") ||
        (error?.status === 503) ||
        (error?.code === 503);

      if (isUnavailable && attempt < retries) {
        const backoff = delayMs * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.warn(`⚠️ Gemini API call failed (503/UNAVAILABLE). Retrying attempt ${attempt}/${retries} in ${Math.round(backoff)}ms... Error: ${errorMessage}`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Retry logic fell through unexpectedly.");
}

function isValidStripeSecretKey(key: string | undefined): boolean {
  const trimmed = key?.trim();
  return !!trimmed && (trimmed.startsWith("sk_test_") || trimmed.startsWith("sk_live_"));
}

// Lazy Stripe Client Loader
let stripeClient: Stripe | null = null;
function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!isValidStripeSecretKey(key)) {
    return null;
  }
  if (!stripeClient) {
    stripeClient = new Stripe(key!);
  }
  return stripeClient;
}

async function isPaymentAlreadyProcessed(paymentId: string): Promise<boolean> {
  if (isUsingFallbackDb) {
    const db = loadLocalDb();
    return !!(db.payments[paymentId] && db.payments[paymentId].status === "completed");
  }
  if (!fdb) return false;
  const paymentDoc = await fdb.collection("payments").doc(paymentId).get();
  return paymentDoc.exists && paymentDoc.data()?.status === "completed";
}

async function recordPaymentAndGrantCredits(params: {
  paymentId: string;
  userId: string;
  credits: number;
  amount: number;
  currency: string;
  packageId?: string;
  stripePaymentIntent?: string;
  stripeSessionId?: string;
}): Promise<boolean> {
  if (await isPaymentAlreadyProcessed(params.paymentId)) {
    console.log(`Payment already processed: ${params.paymentId}`);
    return false;
  }

  const paymentRecord = {
    id: params.paymentId,
    userId: params.userId,
    stripePaymentIntent: params.stripePaymentIntent || "",
    stripeSessionId: params.stripeSessionId || "",
    stripeInvoiceId: "",
    stripeSubscriptionId: "",
    packageId: params.packageId || "",
    amount: params.amount,
    currency: params.currency.toUpperCase(),
    creditsPurchased: params.credits,
    status: "completed",
    createdAt: isUsingFallbackDb ? new Date().toISOString() : FieldValue.serverTimestamp(),
  };

  if (isUsingFallbackDb) {
    const db = loadLocalDb();
    db.payments[params.paymentId] = paymentRecord;
    const user = db.users[params.userId];
    if (user) {
      const currentCredits = user.meetingCredits || 0;
      user.meetingCredits = currentCredits + params.credits;
      user.accountType = "paid";
      user.updatedAt = new Date().toISOString();
    }
    saveLocalDb(db);
    console.log(`Credited ${params.credits} credits to user ${params.userId} (payment ${params.paymentId}).`);
    return true;
  }

  if (!fdb) return false;

  const paymentRef = fdb.collection("payments").doc(params.paymentId);
  const userRef = fdb.collection("users").doc(params.userId);

  try {
    await fdb.runTransaction(async (transaction) => {
      const paymentDoc = await transaction.get(paymentRef);
      const userDoc = await transaction.get(userRef);

      if (paymentDoc.exists && paymentDoc.data()?.status === "completed") {
        throw new Error("DUPLICATE_PAYMENT");
      }

      transaction.set(paymentRef, paymentRecord);

      if (userDoc.exists) {
        const currentCredits = userDoc.data()?.meetingCredits || 0;
        transaction.update(userRef, {
          meetingCredits: currentCredits + params.credits,
          accountType: "paid",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
  } catch (err: any) {
    if (err.message === "DUPLICATE_PAYMENT") {
      return false;
    }
    throw err;
  }

  console.log(`Credited ${params.credits} credits to user ${params.userId} (payment ${params.paymentId}).`);
  return true;
}

async function updateUserStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void> {
  if (!stripeCustomerId) return;

  const updates = {
    stripeCustomerId,
    updatedAt: isUsingFallbackDb ? new Date().toISOString() : FieldValue.serverTimestamp(),
  };

  if (isUsingFallbackDb) {
    const db = loadLocalDb();
    const user = db.users[userId];
    if (user) {
      Object.assign(user, updates);
      user.updatedAt = new Date().toISOString();
      saveLocalDb(db);
    }
    return;
  }

  if (!fdb) return;
  const userRef = fdb.collection("users").doc(userId);
  const userDoc = await userRef.get();
  if (userDoc.exists) {
    await userRef.update(updates);
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Stripe Webhook Endpoint (MUST be registered before express.json() for signature verification)
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const stripe = getStripe();
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    if (stripe && sig && endpointSecret) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      } catch (err: any) {
        console.error(`Webhook Signature verification failed:`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    } else if (isProduction) {
      console.error("Stripe webhook rejected: signature verification required in production.");
      return res.status(400).send("Webhook signature verification required.");
    } else {
      try {
        const payload = JSON.parse(req.body.toString());
        event = {
          type: payload.type,
          data: payload.data
        };
        console.warn("Stripe webhook received without signature verification (dev only).");
      } catch (err) {
        return res.status(400).send("Invalid webhook payload");
      }
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as any;
        const sessionId = session.id;
        const userId = session.metadata?.userId;
        const credits = parseCreditQuantity(session.metadata?.credits);
        const packageId = session.metadata?.packageId || creditsToPackageId(credits) || "";
        const amount = session.amount_total || (packageId && packageId in CREDIT_PACKAGES
          ? CREDIT_PACKAGES[packageId as PackageId].priceSen
          : credits * CREDIT_PRICE_SEN);
        const currency = session.currency || "myr";
        const paymentIntent =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id || "";
        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id || "";

        if (userId) {
          if (customerId) {
            await updateUserStripeCustomerId(userId, customerId);
          }

          await recordPaymentAndGrantCredits({
            paymentId: sessionId,
            userId,
            credits,
            amount,
            currency,
            packageId,
            stripePaymentIntent: paymentIntent,
            stripeSessionId: sessionId,
          });
        }
      }
    } catch (err: any) {
      if (err.message === "DUPLICATE_PAYMENT") {
        return res.json({ received: true, duplicate: true });
      }
      console.error(`Webhook handler error for ${event.type}:`, err);
      return res.status(500).json({ error: "Webhook handler failed" });
    }

    res.json({ received: true });
  });

  // Middleware for standard API requests
  app.use(express.json());

  // API Check / Health
  app.get("/api/health", (req, res) => {
    const geminiConfigured = !!process.env.GEMINI_API_KEY?.trim();
    const build = readBuildMeta();
    res.json({
      status: "ok",
      serverOnline: true,
      geminiConfigured,
      geminiModel: GEMINI_MODEL,
      processingModel: GEMINI_MODEL,
      buildId: build.buildId || null,
      builtAt: build.builtAt || null,
      environment: isProduction ? "production" : "development",
    });
  });

  // Live probe: actually calls generateContent so we can prove the processing path model.
  app.get("/api/gemini-probe", async (_req, res) => {
    if (!process.env.GEMINI_API_KEY?.trim()) {
      return res.status(503).json({
        ok: false,
        model: GEMINI_MODEL,
        error: "GEMINI_API_KEY is not configured",
      });
    }
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: "Reply with the single word OK.",
      });
      const text = (response.text || "").trim();
      return res.json({
        ok: true,
        model: "gemini-3.5-flash",
        reply: text.slice(0, 80),
      });
    } catch (err: any) {
      return res.status(500).json({
        ok: false,
        model: "gemini-3.5-flash",
        error: formatGeminiError(err, "gemini-3.5-flash"),
      });
    }
  });

  // Stripe Billing Config
  app.get("/api/stripe/config", (req, res) => {
    const rawKey = process.env.STRIPE_SECRET_KEY?.trim();
    const keyFormatValid = isValidStripeSecretKey(rawKey);
    const webhookConfigured = !!process.env.STRIPE_WEBHOOK_SECRET?.trim();
    const packages = Object.entries(CREDIT_PACKAGES).map(([packageId, pkg]) => ({
      packageId,
      credits: pkg.credits,
      priceRm: pkg.priceSen / 100,
      priceConfigured: !!process.env[pkg.envVar]?.trim(),
    }));
    res.json({
      configured: keyFormatValid && packages.every((p) => p.priceConfigured),
      keyPresent: !!rawKey,
      keyFormatValid,
      webhookConfigured,
      mode: "payment",
      packages,
    });
  });

  // Create Stripe Checkout Session for one-time meeting credit packages
  app.post("/api/stripe/checkout-session", verifyFirebaseAuth, requireUserMatch, async (req, res) => {
    try {
      const { packageId, quantity, credits: creditsQuantity, userId, email } = req.body;

      if (!userId) {
        return res.status(400).json({ error: "User ID is required to associate purchase." });
      }

      const stripe = getStripe();
      const appUrl = (process.env.APP_URL || `http://${req.headers.host}`).replace(/\/$/, "");

      let resolvedPackage: ReturnType<typeof resolvePackage>;
      try {
        resolvedPackage = resolvePackage({ packageId, credits: creditsQuantity ?? quantity });
      } catch (pkgErr: any) {
        return res.status(400).json({ error: pkgErr.message });
      }

      const { credits, priceId } = resolvedPackage;
      const resolvedPackageId = resolvedPackage.packageId;

      if (!stripe) {
        if (isProduction) {
          return res.status(503).json({ error: "Payment processing is not configured. Contact support." });
        }
        console.log(`Stripe is not configured. Returning simulated checkout for ${credits} credit(s).`);
        return res.json({
          url: `${appUrl}?checkout_success=true&simulated=true&credits=${credits}&packageId=${resolvedPackageId}&userId=${userId}`,
          simulated: true,
          packageId: resolvedPackageId,
          credits,
          userId,
        });
      }

      console.log(
        `Creating Stripe one-time checkout for ${credits} credit(s) (${resolvedPackageId}) using price ${priceId}...`
      );

      const profile = await getUserProfile(userId);
      const existingCustomerId = profile?.stripeCustomerId?.trim();

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "payment",
        metadata: {
          userId,
          credits: String(credits),
          packageId: resolvedPackageId,
        },
        success_url: `${appUrl}?checkout_success=true&session_id={CHECKOUT_SESSION_ID}&credits=${credits}&packageId=${resolvedPackageId}`,
        cancel_url: `${appUrl}?checkout_cancelled=true`,
      };

      if (existingCustomerId) {
        sessionParams.customer = existingCustomerId;
      } else if (email) {
        sessionParams.customer_email = email;
      }

      const session = await stripe.checkout.sessions.create(sessionParams);

      res.json({
        url: session.url,
        simulated: false,
        packageId: resolvedPackageId,
        credits,
        mode: "payment",
      });
    } catch (error: any) {
      console.error("Stripe checkout session creation failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Secure Server-Side Simulated Payment Success (dev/preview only)
  app.post("/api/stripe/simulated-success", verifyFirebaseAuth, requireUserMatch, async (req, res) => {
    try {
      if (isProduction) {
        return res.status(403).json({ error: "Simulated payments are disabled in production." });
      }

      const { userId, quantity, credits: creditsQuantity } = req.body;
      const credits = parseCreditQuantity(quantity ?? creditsQuantity);

      if (!userId) {
        return res.status(400).json({ error: "Invalid simulated checkout parameters." });
      }

      const amount = await creditPurchaseAmount(credits);
      const simulatedSessionId = `sim_session_${Date.now()}`;

      if (isUsingFallbackDb) {
        const db = loadLocalDb();
        db.payments[simulatedSessionId] = {
          id: simulatedSessionId,
          userId,
          stripePaymentIntent: `sim_pi_${Date.now()}`,
          stripeSessionId: simulatedSessionId,
          amount,
          currency: "MYR",
          creditsPurchased: credits,
          status: "completed",
          createdAt: new Date().toISOString()
        };

        const user = db.users[userId];
        if (user) {
          const currentCredits = user.meetingCredits || 0;
          user.meetingCredits = currentCredits + credits;
          user.accountType = "paid";
          user.updatedAt = new Date().toISOString();
        }
        saveLocalDb(db);

        return res.json({
          success: true,
          sessionId: simulatedSessionId,
          creditsPurchased: credits
        });
      }

      if (fdb) {
        const paymentRef = fdb.collection("payments").doc(simulatedSessionId);

        await paymentRef.set({
          id: simulatedSessionId,
          userId,
          stripePaymentIntent: `sim_pi_${Date.now()}`,
          stripeSessionId: simulatedSessionId,
          amount,
          currency: "MYR",
          creditsPurchased: credits,
          status: "completed",
          createdAt: FieldValue.serverTimestamp()
        });

        const userRef = fdb.collection("users").doc(userId);
        await fdb.runTransaction(async (transaction) => {
          const userDoc = await transaction.get(userRef);
          if (userDoc.exists) {
            const currentCredits = userDoc.data()?.meetingCredits || 0;
            transaction.update(userRef, {
              meetingCredits: currentCredits + credits,
              accountType: "paid",
              updatedAt: FieldValue.serverTimestamp()
            });
          }
        });

        res.json({
          success: true,
          sessionId: simulatedSessionId,
          creditsPurchased: credits
        });
      } else {
        res.status(500).json({ error: "Database not connected." });
      }
    } catch (error: any) {
      console.error("Simulated success API failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get or Create User Profile API
  app.get("/api/user/profile", verifyFirebaseAuth, requireUserMatch, async (req, res) => {
    try {
      const userId = req.query.userId as string;
      const email = req.query.email as string;
      const displayName = req.query.displayName as string;
      const photoURL = req.query.photoURL as string;

      if (!userId) {
        return res.status(400).json({ error: "Missing userId" });
      }

      const profile = await ensureUserProfileExists(userId, email, displayName, photoURL);
      res.json(profile);
    } catch (error: any) {
      console.error("Error in /api/user/profile:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete User Account and associated data securely
  app.post("/api/user/delete", verifyFirebaseAuth, requireUserMatch, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "Missing userId" });
      }

      if (isUsingFallbackDb) {
        const db = loadLocalDb();
        
        // Remove user
        delete db.users[userId];
        
        // Remove meetings
        for (const meetingId of Object.keys(db.meetings)) {
          if (db.meetings[meetingId].userId === userId) {
            delete db.meetings[meetingId];
          }
        }

        // Remove payments
        for (const paymentId of Object.keys(db.payments)) {
          if (db.payments[paymentId].userId === userId) {
            delete db.payments[paymentId];
          }
        }

        saveLocalDb(db);
        console.log(`[Local DB] Fully purged account and data for user: ${userId}`);
      } else if (fdb) {
        await fdb.collection("users").doc(userId).delete();

        const meetingsSnapshot = await fdb.collection("meetings").where("userId", "==", userId).get();
        const batch = fdb.batch();
        meetingsSnapshot.docs.forEach(doc => batch.delete(doc.ref));

        const paymentsSnapshot = await fdb.collection("payments").where("userId", "==", userId).get();
        paymentsSnapshot.docs.forEach(doc => batch.delete(doc.ref));

        await batch.commit();
        console.log(`Fully purged account and data for user: ${userId}`);
      }

      res.json({ success: true, message: "Account and associated meetings and payments deleted successfully." });
    } catch (error: any) {
      console.error("Error deleting user account:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Meetings History Fetch API
  app.get("/api/meetings/history", verifyFirebaseAuth, requireUserMatch, async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ error: "Missing userId" });
      }

      if (isUsingFallbackDb) {
        const db = loadLocalDb();
        const meetings = Object.values(db.meetings)
          .filter((m: any) => m.userId === userId)
          .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return res.json(meetings);
      }

      if (!fdb) {
        return res.json([]);
      }

      const snapshot = await fdb.collection("meetings")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .get();

      const meetings = snapshot.docs.map(doc => ({
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate().toISOString() : doc.data().createdAt
      }));

      res.json(meetings);
    } catch (error: any) {
      console.error("Error fetching meetings history:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Payments History Fetch API
  app.get("/api/payments/history", verifyFirebaseAuth, requireUserMatch, async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ error: "Missing userId" });
      }

      if (isUsingFallbackDb) {
        const db = loadLocalDb();
        const payments = Object.values(db.payments)
          .filter((p: any) => p.userId === userId)
          .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return res.json(payments);
      }

      if (!fdb) {
        return res.json([]);
      }

      const snapshot = await fdb.collection("payments")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .get();

      const payments = snapshot.docs.map(doc => ({
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate().toISOString() : doc.data().createdAt
      }));

      res.json(payments);
    } catch (error: any) {
      console.error("Error fetching payments history:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Receive chunked audio file
  app.post(
    "/api/recording/chunk",
    express.raw({ type: "*/*", limit: "500mb" }),
    verifyFirebaseAuth,
    requireUserMatch,
    async (req, res) => {
      try {
        const { meetingId, chunkIndex } = req.query;
        if (!meetingId) {
          return res.status(400).json({ error: "Missing meetingId" });
        }

        const userId = (req.headers["x-user-id"] as string) || (req.query.userId as string);
        if (userId) {
          const profile = await getUserProfile(userId);
          const credits = profile?.meetingCredits || 0;
          if (credits <= 0) {
            return res.status(403).json({
              error: "INSUFFICIENT_CREDITS",
              message: "No Meeting Credits Remaining. Purchase one Meeting Credit (RM39) to continue."
            });
          }
        }

        const filePath = path.join(process.cwd(), "uploads", `meeting-${meetingId}.webm`);
        fs.appendFileSync(filePath, req.body);

        res.json({ success: true, chunkIndex });
      } catch (error: any) {
        console.error("Error saving chunk:", error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Shared processing function for both real-time streams and direct uploads
  async function handleAudioProcessing({
    filePath,
    mimeType,
    title,
    googleToken,
    clientDateTime,
  }: {
    filePath: string;
    mimeType: string;
    title: string;
    googleToken?: string;
    clientDateTime?: string;
  }) {
    let uploadedFile: any = null;

    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured on the server.");
      }

      // Check if file exists and has valid size (reject empty / near-empty captures before Gemini)
      if (!fs.existsSync(filePath)) {
        throw new Error("Local audio recording file was not found on the server.");
      }
      const stats = fs.statSync(filePath);
      if (stats.size < MIN_AUDIO_BYTES) {
        const err: any = new Error(
          "Recording too short / no audio captured. Please record for at least a few seconds with a working microphone."
        );
        err.code = "AUDIO_TOO_SHORT";
        throw err;
      }

      // Transcode raw input file to standard mp3 for maximum compatibility and minimal size
      const transcodedPath = filePath + ".transcoded.mp3";
      let activeFilePath = filePath;
      let activeMimeType = (mimeType || "audio/webm").split(";")[0].trim().toLowerCase();

      // Normalize non-standard browser MIME types
      if (activeMimeType === "audio/x-m4a") activeMimeType = "audio/m4a";

      const transcodeSuccess = transcodeToMp3(filePath, transcodedPath);
      if (transcodeSuccess && fs.existsSync(transcodedPath)) {
        activeFilePath = transcodedPath;
        activeMimeType = "audio/mpeg"; // audio/mpeg is the standard official MIME type for MP3
      } else {
        console.warn("Falling back to original audio format since ffmpeg transcoding failed.");
      }

      const activeStats = fs.statSync(activeFilePath);
      let audioPart: any;

      if (activeStats.size < 20 * 1024 * 1024) {
        console.log(`Using inlineData for file ${activeFilePath} with size ${activeStats.size} bytes (< 20MB)...`);
        const base64Data = fs.readFileSync(activeFilePath).toString("base64");
        audioPart = {
          inlineData: {
            mimeType: activeMimeType,
            data: base64Data,
          },
        };
      } else {
        console.log(`Uploading large file ${activeFilePath} (${activeMimeType}) with size ${activeStats.size} bytes to Gemini Files API...`);
        uploadedFile = await callWithRetry(() => ai.files.upload({
          file: activeFilePath,
          mimeType: activeMimeType,
        } as any));

        console.log(`Waiting for Gemini to process the audio file... File Name: ${uploadedFile.name}`);
        let fileState = uploadedFile.state;
        while (fileState === "PROCESSING") {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const fileInfo = await callWithRetry(() => ai.files.get({ name: uploadedFile.name }));
          fileState = fileInfo.state;
          uploadedFile = fileInfo;
        }

        if (fileState === "FAILED") {
          console.error("Gemini File Processing Failed Details:", JSON.stringify(uploadedFile, null, 2));
          const failureReason = uploadedFile.error?.message || "unsupported format or empty audio stream";
          throw new Error(`Gemini file processing failed: ${failureReason}`);
        }
        audioPart = {
          fileData: {
            fileUri: uploadedFile.uri,
            mimeType: uploadedFile.mimeType,
          },
        };
      }

      console.log("Audio file processed. Generating English transcript and meeting minutes...");

      const dateToUse = clientDateTime || new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

      const prompt = `You are a professional meeting transcriptionist, expert translator, and elite executive assistant.
Analyze the attached meeting audio. Please complete the following tasks:
1. Translate any and all spoken non-English languages (including but not limited to Chinese, Malay, Tamil, Spanish, French, German, Japanese, etc.) into clear, grammatically correct English.
2. Produce a full, readable English transcript of the entire meeting with speakers or topics clearly indicated. 100% of this transcript must be in English.
3. Generate structured, polished meeting minutes based on the translated transcript. These minutes must be written entirely in English and include:
   - Meeting Title: ${title}
   - Date & Time: ${dateToUse} (or use the one mentioned in the audio if specified)
   - Executive Summary
   - List of Attendees/Speakers (if identified)
   - Key Discussion Points
   - Decisions Made
   - Action Items (with designated owners and deadlines if applicable)

CRITICAL FAITHFULNESS & TRUTHFULNESS RULES:
- You MUST base the transcript and meeting minutes EXCLUSIVELY on the actual spoken content in the provided audio file.
- Do NOT hallucinate, invent, or assume any facts, speakers, topics, decisions, or action items that are not explicitly stated or discussed in the audio.
- If a section (such as Action Items or Decisions Made) has no corresponding content spoken in the meeting, state "None discussed" or "No action items were mentioned in the recording." rather than making them up.
- If the audio contains only silence, non-speech background noise, music, is extremely short with no speech, or is completely unintelligible, do NOT generate any fake transcript or meeting minutes. Instead, set the 'transcript' field exactly to: "[No intelligible speech detected in the recording. Please check your microphone, ensure you are speaking clearly, and try recording again.]", and set the 'minutes' field exactly to: "### No Speech Detected\n\nNo intelligible spoken words or discussion could be detected in the provided audio recording. As a result, no meeting minutes could be generated. Please make sure your microphone is active and you are speaking clearly during the recording."
- Do NOT insert standard placeholder corporate conversations (e.g., discussing project status, timelines, or marketing campaigns) unless they were actually spoken in the recording.

CRITICAL FORMATTING:
In the "Meeting Title, Date & Time" section of your generated meeting minutes, please use:
Title: ${title}
Date & Time: ${dateToUse} (or the explicitly stated date/time from the audio).
Ensure the date and time match this exact format so it is consistent. All generated output (both transcript and meeting minutes) MUST be entirely in English. If the meeting was conducted in another language, translate it fully.

Return your response in structured JSON format according to the requested schema.`;

      console.log(`Calling Gemini generateContent with model=gemini-3.5-flash ...`);

      const response = await callWithRetry(() => ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [audioPart, prompt],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcript: {
                type: Type.STRING,
                description: "The complete, fully-translated verbatim English transcript of the meeting. This must be written 100% in English, regardless of the original spoken language(s). For long meetings, provide a comprehensive section-by-section transcript showing who spoke what, but condense redundant or filler talk. If no speech was detected or if the audio contains only silence/noise, return '[No intelligible speech detected in the recording. Please check your microphone, ensure you are speaking clearly, and try recording again.]'.",
              },
              minutes: {
                type: Type.STRING,
                description: "The highly polished, structured meeting minutes formatted in beautiful Markdown layout. This must be written 100% in English. If no speech was detected, return a brief Markdown message stating that no speech could be detected and no meeting minutes could be generated.",
              },
            },
            required: ["transcript", "minutes"],
          },
        },
      }));

      const resultText = response.text;
      if (!resultText) {
        throw new Error("Gemini returned empty transcription results.");
      }

      let parsedResult: { transcript: string; minutes: string };
      try {
        parsedResult = JSON.parse(resultText);
      } catch (jsonErr: any) {
        console.warn("JSON parsing failed, attempting fallback regex parsing on raw response...", jsonErr.message);
        
        // Fallback: extract fields using regex
        let transcript = "";
        let minutes = "";

        const transcriptMatch = resultText.match(/"transcript"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
        if (transcriptMatch) {
          transcript = transcriptMatch[1]
            .replace(/\\n/g, "\n")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
        }

        const minutesMatch = resultText.match(/"minutes"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
        if (minutesMatch) {
          minutes = minutesMatch[1]
            .replace(/\\n/g, "\n")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
        }

        // If we extracted at least something, use it. Otherwise, fallback or throw.
        if (transcript || minutes) {
          parsedResult = {
            transcript: transcript || "Transcript extraction partially succeeded, but JSON was truncated.",
            minutes: minutes || "Minutes extraction partially succeeded, but JSON was truncated.",
          };
        } else {
          try {
            // Try to find first { and last } to parse a cleaner chunk of JSON
            const startIdx = resultText.indexOf("{");
            const endIdx = resultText.lastIndexOf("}");
            if (startIdx !== -1 && endIdx !== -1) {
              parsedResult = JSON.parse(resultText.substring(startIdx, endIdx + 1));
            } else {
              throw jsonErr;
            }
          } catch (secondErr) {
            // Ultimate fallback: treat entire result text as minutes, and provide a helpful transcript note
            parsedResult = {
              transcript: "Verbatim transcript was truncated due to meeting length. Please review the structured minutes.",
              minutes: resultText,
            };
          }
        }
      }

      // Save to Google Docs if authorized
      let googleDoc = null;
      if (googleToken) {
        console.log("Saving meeting minutes to Google Docs...");
        try {
          const docTitle = title ? `${title} - Meeting Minutes` : "Meeting Minutes";
          
          // Create the blank Doc
          const createRes = await fetch("https://docs.googleapis.com/v1/documents", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${googleToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ title: docTitle }),
          });

          if (!createRes.ok) {
            const errBody = await createRes.text();
            if (
              createRes.status === 403 &&
              (errBody.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
                errBody.includes("insufficient authentication scopes"))
            ) {
              throw new Error(
                "Google Docs export needs additional OAuth scopes. Ask the user to reconnect Google Docs (documents + drive.file)."
              );
            }
            const lower = errBody.toLowerCase();
            if (
              lower.includes("has not been used") ||
              lower.includes("is disabled") ||
              lower.includes("accessnotconfigured") ||
              lower.includes("service_disabled")
            ) {
              throw new Error(
                "Google Docs API or Google Drive API is not enabled. Enable both in GCP Console for project gen-lang-client-0135145658, then retry."
              );
            }
            throw new Error(`Google Docs creation failed: ${createRes.status} ${errBody}`);
          }

          const docData: any = await createRes.json();
          const docId = docData.documentId;

          // Build content to write
          const minutesContent = parsedResult.minutes;
          const transcriptContent = parsedResult.transcript;
          
          const fullDocText = `${docTitle}\n\n=========================================\nMEETING MINUTES\n=========================================\n\n${minutesContent}\n\n=========================================\nRAW TRANSCRIPT\n=========================================\n\n${transcriptContent}`;

          // Write to the Doc
          const updateRes = await fetch(
            `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${googleToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                requests: [
                  {
                    insertText: {
                      location: { index: 1 },
                      text: fullDocText,
                    },
                  },
                ],
              }),
            }
          );

          if (updateRes.ok) {
            googleDoc = {
              id: docId,
              title: docTitle,
              url: `https://docs.google.com/document/d/${docId}/edit`,
            };
            console.log("Saved successfully to Google Doc:", docId);
          } else {
            console.error("Failed to write content into Google Doc:", await updateRes.text());
          }
        } catch (docErr: any) {
          console.error("Google Docs integration error:", docErr);
        }
      }

      return {
        success: true,
        transcript: parsedResult.transcript,
        minutes: parsedResult.minutes,
        googleDoc,
        noSpeechDetected: isNoSpeechResult(parsedResult.transcript, parsedResult.minutes),
      };
    } finally {
      // Clean up original local temp file
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        console.error("Cleanup error for raw path:", e);
      }
      // Clean up transcoded local temp file
      try {
        const transcodedPath = filePath + ".transcoded.mp3";
        if (fs.existsSync(transcodedPath)) {
          fs.unlinkSync(transcodedPath);
        }
      } catch (e) {
        console.error("Cleanup error for transcoded path:", e);
      }
      // Clean up Gemini temporary file
      try {
        if (uploadedFile && uploadedFile.name) {
          console.log(`Deleting temporary Gemini file ${uploadedFile.name}`);
          await ai.files.delete({ name: uploadedFile.name });
        }
      } catch (cleanErr) {
        console.error("Error doing file cleanups:", cleanErr);
      }
    }
  }

  // Upload an entire raw audio file directly
  app.post(
    "/api/recording/upload",
    express.raw({ type: "*/*", limit: "500mb" }),
    verifyFirebaseAuth,
    requireUserMatch,
    async (req, res) => {
      try {
        const clientDateTime = req.query.clientDateTime as string;
        const title = (req.query.title as string) || (clientDateTime ? `Meeting on ${clientDateTime}` : `Uploaded Meeting ${new Date().toLocaleDateString()}`);
        const mimeType = (req.query.mimeType as string) || "audio/webm";
        const googleToken = req.headers["x-google-token"] as string;
        const userId = (req.headers["x-user-id"] as string) || (req.query.userId as string);

        if (!userId) {
          return res.status(400).json({ error: "User ID is required to process audio." });
        }

        const bodyLen = Buffer.isBuffer(req.body)
          ? req.body.length
          : req.body
            ? Buffer.byteLength(req.body)
            : 0;
        if (bodyLen < MIN_AUDIO_BYTES) {
          return res.status(400).json({
            error: "AUDIO_TOO_SHORT",
            message:
              "Recording too short / no audio captured. Please record for at least a few seconds with a working microphone, or upload a longer audio file.",
          });
        }

        // Verify user has meeting credits
        const profile = await getUserProfile(userId);
        const credits = profile?.meetingCredits || 0;

        if (credits <= 0) {
          return res.status(403).json({ 
            error: "INSUFFICIENT_CREDITS", 
            message: "No Meeting Credits Remaining. Purchase one Meeting Credit (RM39) to continue." 
          });
        }

        // Generate unique id for file extension detection/preservation
        const meetingId = `upload_${Date.now()}`;
        let extension = "webm";
        if (mimeType.includes("mp3") || mimeType.includes("mpeg")) extension = "mp3";
        else if (mimeType.includes("wav")) extension = "wav";
        else if (mimeType.includes("ogg")) extension = "ogg";
        else if (mimeType.includes("m4a") || mimeType.includes("aac")) extension = "m4a";
        else if (mimeType.includes("mp4")) extension = "mp4";

        const filePath = path.join(process.cwd(), "uploads", `meeting-${meetingId}.${extension}`);
        
        console.log(`Writing raw direct upload to: ${filePath} (${bodyLen} bytes)`);
        fs.writeFileSync(filePath, req.body);

        const result = await handleAudioProcessing({
          filePath,
          mimeType,
          title,
          googleToken,
          clientDateTime,
        });

        if (result.success) {
          const noSpeech = !!(result as any).noSpeechDetected;
          let creditCharged = false;
          let creditsRemaining = credits;

          // Do not charge when Gemini reports no intelligible speech
          if (!noSpeech) {
            const creditDeducted = await deductCredit(userId);
            if (creditDeducted) {
              creditCharged = true;
              creditsRemaining = credits - 1;
              console.log(`Deducted 1 credit from user ${userId} for upload meeting processing.`);
            }
          } else {
            console.log(`Skipping credit deduction for user ${userId}: no speech detected in audio.`);
          }

          // Save meeting record in Firestore
          const savedMeeting = await saveMeetingToDb({
            userId,
            title,
            duration: 0,
            language: "Detected",
            summary: result.minutes ? result.minutes.split("\n")[0].substring(0, 300) : "",
            minutes: result.minutes || "",
            actionItems: result.minutes ? "Extracted in meeting minutes." : "",
            status: "processed",
            googleDoc: result.googleDoc || null
          });

          return res.json({
            ...result,
            meeting: savedMeeting,
            meetingCreditsRemaining: creditsRemaining,
            creditCharged,
            noSpeechDetected: noSpeech,
          });
        }

        res.json(result);
      } catch (error: any) {
        console.error("Direct file upload processing failed:", error);
        if (error?.code === "AUDIO_TOO_SHORT") {
          return res.status(400).json({
            error: "AUDIO_TOO_SHORT",
            message: error.message,
          });
        }
        res.status(500).json({
          error: formatGeminiError(error, "gemini-3.5-flash"),
          model: "gemini-3.5-flash",
        });
      }
    }
  );

  // Stop recording and process meeting audio
  app.post("/api/recording/stop", verifyFirebaseAuth, requireUserMatch, async (req, res) => {
    const { meetingId, title, googleToken, userId: bodyUserId, clientDateTime } = req.body;
    const headerUserId = req.headers["x-user-id"] as string;
    const userId = bodyUserId || headerUserId;

    if (!meetingId) {
      return res.status(400).json({ error: "Missing meetingId" });
    }

    if (!userId) {
      return res.status(400).json({ error: "User ID is required to process recording." });
    }

    // Verify user has meeting credits
    const profile = await getUserProfile(userId);
    const credits = profile?.meetingCredits || 0;

    const filePath = path.join(process.cwd(), "uploads", `meeting-${meetingId}.webm`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Audio file not found for this meeting" });
    }

    if (credits <= 0) {
      return res.status(403).json({ 
        error: "INSUFFICIENT_CREDITS", 
        message: "No Meeting Credits Remaining. Purchase one Meeting Credit (RM39) to continue." 
      });
    }

    try {
      const result = await handleAudioProcessing({
        filePath,
        mimeType: "audio/webm",
        title: title || (clientDateTime ? `Meeting on ${clientDateTime}` : `Meeting on ${new Date().toLocaleDateString()}`),
        googleToken,
        clientDateTime,
      });

      if (result.success) {
        const noSpeech = !!(result as any).noSpeechDetected;
        let creditCharged = false;
        let creditsRemaining = credits;

        if (!noSpeech) {
          const creditDeducted = await deductCredit(userId);
          if (creditDeducted) {
            creditCharged = true;
            creditsRemaining = credits - 1;
            console.log(`Deducted 1 credit from user ${userId} for recorded meeting processing.`);
          }
        } else {
          console.log(`Skipping credit deduction for user ${userId}: no speech detected in audio.`);
        }

        // Save meeting record in Firestore
        const savedMeeting = await saveMeetingToDb({
          userId,
          title: title || `Meeting on ${new Date().toLocaleDateString()}`,
          duration: 0,
          language: "Detected",
          summary: result.minutes ? result.minutes.split("\n")[0].substring(0, 300) : "",
          minutes: result.minutes || "",
          actionItems: result.minutes ? "Extracted in meeting minutes." : "",
          status: "processed",
          googleDoc: result.googleDoc || null
        });

        return res.json({
          ...result,
          meeting: savedMeeting,
          meetingCreditsRemaining: creditsRemaining,
          creditCharged,
          noSpeechDetected: noSpeech,
        });
      }

      res.json(result);
    } catch (error: any) {
      console.error("Error processing stop meeting:", error);
      if (error?.code === "AUDIO_TOO_SHORT") {
        return res.status(400).json({
          error: "AUDIO_TOO_SHORT",
          message: error.message,
        });
      }
      res.status(500).json({
        error: formatGeminiError(error, "gemini-3.5-flash"),
        model: "gemini-3.5-flash",
      });
    }
  });

  // Global Express Error Handler for API endpoints
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("🔥 Global Express API Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    res.status(err.status || err.statusCode || 500).json({
      error: err.name || "InternalServerError",
      message: err.message || "An unexpected server-side error occurred.",
    });
  });

  // Serve static assets / Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // server.cjs lives in dist/, so resolve assets relative to the running script.
    const distPath = path.dirname(process.argv[1]);
    const staticAssetExtensions =
      /\.(js|mjs|cjs|css|map|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|txt|xml|webmanifest)$/i;

    const setNoCacheHeaders = (res: express.Response) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    };

    app.use(
      express.static(distPath, {
        index: false,
        setHeaders(res, filePath) {
          if (
            filePath.endsWith(".html") ||
            filePath.endsWith("version.json") ||
            filePath.endsWith("firebase-applet-config.json")
          ) {
            setNoCacheHeaders(res);
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      })
    );

    // SPA fallback: only for non-API, extension-less routes.
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api/")) {
        return res.status(404).json({ error: "Not found" });
      }
      if (staticAssetExtensions.test(req.path)) {
        return res.status(404).send("Not found");
      }
      setNoCacheHeaders(res);
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
