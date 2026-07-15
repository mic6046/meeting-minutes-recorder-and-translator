import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { execSync } from "child_process";
import Stripe from "stripe";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { Firestore } from "firebase-admin/firestore";
import type { Request, Response, NextFunction } from "express";

dotenv.config();

import { Agent, setGlobalDispatcher } from "undici";

// Long timeouts for large audio generateContent. Avoid keep-alive reuse quirks on App Hosting.
setGlobalDispatcher(
  new Agent({
    headersTimeout: 900000,
    bodyTimeout: 900000,
    connectTimeout: 120000,
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
    connections: 8,
    pipelining: 0,
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
let storageBucketName: string | null = null;

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
    storageBucketName = config.storageBucket || null;
    let app;
    if (getApps().length === 0) {
      app = initializeApp({
        projectId: config.projectId,
        ...(storageBucketName ? { storageBucket: storageBucketName } : {}),
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
    if (storageBucketName) {
      console.log("📼 Firebase Storage bucket configured:", storageBucketName);
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
// Reliability-first for production audio: lite models work; gemini-3.5 often fetch-fails under load.
const GEMINI_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-flash-lite-latest",
] as const;
const GEMINI_MODEL = GEMINI_MODELS[0];
const MIN_AUDIO_BYTES = 4096;
const NO_SPEECH_ESCALATE_BYTES = 32 * 1024; // large enough file ⇒ likely real audio; don't trust first no-speech

const FREE_REDO_HOURS = 24;
const RECORDING_RETENTION_DAYS = Math.max(
  7,
  parseInt(process.env.RECORDING_RETENTION_DAYS || "90", 10) || 90
);
const isProduction = process.env.NODE_ENV === "production";

function freeRedoUntilFromNow(): string {
  return new Date(Date.now() + FREE_REDO_HOURS * 60 * 60 * 1000).toISOString();
}

function isFreeRedoEligible(meeting: any): boolean {
  if (!meeting?.freeRedoUntil) return false;
  const until = new Date(meeting.freeRedoUntil).getTime();
  return Number.isFinite(until) && Date.now() < until;
}

function errorText(error: any): string {
  const parts = [
    error?.message,
    error?.cause?.message,
    error?.cause?.code,
    error?.code,
    String(error || ""),
  ];
  return parts.filter(Boolean).join(" ");
}

function isQuotaOrUnavailableError(error: any): boolean {
  const msg = errorText(error);
  return (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("high demand") ||
    msg.includes("Quota exceeded") ||
    error?.status === 503 ||
    error?.status === 429 ||
    error?.code === 503 ||
    error?.code === 429
  );
}

/** Model retired / not allowed for this API key — skip to next fallback immediately. */
function isModelUnavailableError(error: any): boolean {
  const msg = errorText(error);
  return (
    msg.includes("NOT_FOUND") ||
    msg.includes("no longer available") ||
    msg.includes("is not found") ||
    error?.status === 404 ||
    error?.code === 404
  );
}

/** Network / client timeouts — fail over instead of aborting the whole request. */
function isTransientNetworkError(error: any): boolean {
  const msg = errorText(error);
  return (
    msg.includes("fetch failed") ||
    msg.includes("HeadersTimeout") ||
    msg.includes("UND_ERR_HEADERS_TIMEOUT") ||
    msg.includes("UND_ERR_BODY_TIMEOUT") ||
    msg.includes("Timeout") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("socket hang up") ||
    msg.includes("network")
  );
}

function shouldTryNextModel(error: any): boolean {
  return (
    isQuotaOrUnavailableError(error) ||
    isModelUnavailableError(error) ||
    isTransientNetworkError(error)
  );
}

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
  const cause = err?.cause?.message || err?.cause?.code || "";
  const raw = [err?.message || String(err), cause].filter(Boolean).join(" — ");
  if (/fetch failed|UND_ERR|Timeout|ECONNRESET/i.test(raw)) {
    return `AI service connection failed while using "${modelUsed}". Please retry — this is usually temporary.`;
  }
  return `Gemini model "${modelUsed}" failed: ${raw}`;
}

interface AuthedRequest extends Request {
  authedUid?: string;
}

function getClaimedUserId(req: Request): string | undefined {
  const body = req.body as unknown;
  // express.raw() leaves a Buffer — never treat it as a JSON user payload
  const fromBody =
    body &&
    typeof body === "object" &&
    !Buffer.isBuffer(body) &&
    !Array.isArray(body)
      ? (body as { userId?: string }).userId
      : undefined;
  const fromQuery = req.query.userId as string | undefined;
  const fromHeader = req.headers["x-user-id"] as string | undefined;
  return fromBody || fromQuery || fromHeader;
}

/** Prefer verified token uid over client-claimed ids. */
function resolveAuthedUserId(req: AuthedRequest): string | undefined {
  return req.authedUid || getClaimedUserId(req);
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
  id?: string;
  userId: string;
  title: string;
  duration: number;
  language: string;
  summary: string;
  minutes: string;
  transcript?: string;
  actionItems: string;
  status: string;
  googleDoc?: any;
  audioStoragePath?: string;
  audioLocalRelativePath?: string;
  audioMimeType?: string;
  hasAudio?: boolean;
}) {
  const meetingId = meetingData.id || `meeting_${Date.now()}`;
  const { id: _omitId, ...rest } = meetingData;
  const data = {
    id: meetingId,
    ...rest,
    hasAudio: !!(meetingData.audioStoragePath || meetingData.audioLocalRelativePath),
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

async function getMeetingById(meetingId: string): Promise<any | null> {
  if (isUsingFallbackDb) {
    const db = loadLocalDb();
    return db.meetings[meetingId] || null;
  }
  if (!fdb) return null;
  const doc = await fdb.collection("meetings").doc(meetingId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function updateMeetingInDb(meetingId: string, updates: Record<string, any>) {
  if (isUsingFallbackDb) {
    const db = loadLocalDb();
    if (!db.meetings[meetingId]) return null;
    db.meetings[meetingId] = {
      ...db.meetings[meetingId],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    saveLocalDb(db);
    return db.meetings[meetingId];
  }
  if (!fdb) return null;
  const meetingRef = fdb.collection("meetings").doc(meetingId);
  await meetingRef.update({
    ...updates,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const doc = await meetingRef.get();
  return { id: doc.id, ...doc.data() };
}

/** Keep a durable copy of the recording (local + Cloud Storage when available). */
async function persistRecording(opts: {
  sourcePath: string;
  userId: string;
  meetingId: string;
  mimeType: string;
}): Promise<{
  audioStoragePath: string;
  audioLocalRelativePath: string;
  audioMimeType: string;
}> {
  const ext = path.extname(opts.sourcePath) || ".webm";
  const relativePath = path.join("uploads", "recordings", opts.userId, `${opts.meetingId}${ext}`);
  const destAbsolute = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(destAbsolute), { recursive: true });

  if (path.resolve(opts.sourcePath) !== path.resolve(destAbsolute)) {
    fs.copyFileSync(opts.sourcePath, destAbsolute);
  }

  let audioStoragePath = "";
  if (storageBucketName) {
    try {
      const storagePath = `recordings/${opts.userId}/${opts.meetingId}${ext}`;
      await getStorage().bucket(storageBucketName).upload(destAbsolute, {
        destination: storagePath,
        metadata: {
          contentType: opts.mimeType,
          metadata: { userId: opts.userId, meetingId: opts.meetingId },
        },
      });
      audioStoragePath = storagePath;
      console.log(`📼 Recording saved to Cloud Storage: gs://${storageBucketName}/${storagePath}`);
    } catch (e: any) {
      console.warn("⚠️ Cloud Storage persist failed:", e.message);
      // Cloud Run disk is ephemeral — without Storage, Redo breaks after restart/scale.
      if (isProduction) {
        throw new Error(
          `Failed to archive recording to Cloud Storage (${e.message}). Enable Firebase Storage for this project and retry.`
        );
      }
    }
  } else if (isProduction) {
    throw new Error(
      "Cloud Storage bucket is not configured. Set storageBucket in firebase-applet-config.json so recordings can be saved for Redo."
    );
  }

  return {
    audioStoragePath,
    audioLocalRelativePath: relativePath.replace(/\\/g, "/"),
    audioMimeType: opts.mimeType,
  };
}

/** Load a saved recording onto disk for (re)processing. */
async function materializeRecording(meeting: any): Promise<{
  filePath: string;
  mimeType: string;
  cleanupTemp: boolean;
}> {
  const mimeType = meeting.audioMimeType || "audio/webm";

  // Prefer Cloud Storage — local uploads/ is ephemeral on Cloud Run
  if (meeting.audioStoragePath && storageBucketName) {
    try {
      const ext = path.extname(meeting.audioStoragePath) || ".webm";
      const tmp = path.join(
        process.cwd(),
        "uploads",
        "tmp",
        `${meeting.id || "meeting"}_${Date.now()}${ext}`
      );
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      await getStorage().bucket(storageBucketName).file(meeting.audioStoragePath).download({
        destination: tmp,
      });
      console.log(`📼 Downloaded recording from Cloud Storage for reprocess: ${meeting.audioStoragePath}`);
      return { filePath: tmp, mimeType, cleanupTemp: true };
    } catch (e: any) {
      console.warn("⚠️ Cloud Storage download failed, trying local archive:", e.message);
    }
  }

  if (meeting.audioLocalRelativePath) {
    const local = path.join(process.cwd(), meeting.audioLocalRelativePath);
    if (fs.existsSync(local) && fs.statSync(local).size > MIN_AUDIO_BYTES) {
      return { filePath: local, mimeType, cleanupTemp: false };
    }
  }

  throw new Error(
    "No saved recording is available for this meeting. Only meetings with a successfully archived recording can be redone."
  );
}

// Transcode raw audio files to standard compressed mp3 using ffmpeg
let ffmpegAvailable: boolean | null = null;
function isFfmpegAvailable(): boolean {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
    console.warn("ffmpeg not found — skipping transcode; using original audio for faster path.");
  }
  return ffmpegAvailable;
}

function transcodeToMp3(inputPath: string, outputPath: string): boolean {
  if (!isFfmpegAvailable()) return false;
  try {
    console.log(`Transcoding audio file from ${inputPath} to ${outputPath}...`);
    try {
      execSync(`ffmpeg -y -i "${inputPath}" -vn -ar 16000 -ac 1 -b:a 64k "${outputPath}"`, {
        stdio: "pipe",
      });
    } catch (execErr: any) {
      console.warn("ffmpeg returned non-zero or warning, checking if output file was created:", execErr.message);
    }

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
    // Audio minutes can take several minutes; default SDK timeouts are too low.
    timeout: 900000,
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Fail over quickly — don't burn time retrying the same overloaded model.
async function callWithRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 600): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (isModelUnavailableError(error)) throw error;
      if (shouldTryNextModel(error) && attempt < retries) {
        const backoff = delayMs * Math.pow(2, attempt - 1) + Math.random() * 300;
        console.warn(
          `⚠️ Gemini API call failed (retryable). Retrying attempt ${attempt}/${retries} in ${Math.round(backoff)}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Retry logic fell through unexpectedly.");
}

function thinkingConfigForModel(model: string) {
  // Gemini 3 defaults to HIGH thinking — that dominates meeting-generation latency.
  // Prefer minimal thinking for transcription+minutes; older models disable budget.
  if (model.startsWith("gemini-3")) {
    return { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  return { thinkingBudget: 0 };
}

function failoverReason(error: any): string {
  if (isModelUnavailableError(error)) return "not available";
  if (isTransientNetworkError(error)) return "timeout/network";
  return "quota/unavailable";
}

function parseMinutesJson(resultText: string): { transcript: string; minutes: string } {
  try {
    return JSON.parse(resultText);
  } catch (jsonErr: any) {
    console.warn("JSON parsing failed, attempting fallback regex parsing on raw response...", jsonErr.message);

    let transcript = "";
    let minutes = "";

    const transcriptMatch = resultText.match(/"transcript"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    if (transcriptMatch) {
      transcript = transcriptMatch[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }

    const minutesMatch = resultText.match(/"minutes"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    if (minutesMatch) {
      minutes = minutesMatch[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }

    if (transcript || minutes) {
      return {
        transcript: transcript || "Transcript extraction partially succeeded, but JSON was truncated.",
        minutes: minutes || "Minutes extraction partially succeeded, but JSON was truncated.",
      };
    }

    try {
      const startIdx = resultText.indexOf("{");
      const endIdx = resultText.lastIndexOf("}");
      if (startIdx !== -1 && endIdx !== -1) {
        return JSON.parse(resultText.substring(startIdx, endIdx + 1));
      }
    } catch {
      // fall through
    }

    return {
      transcript:
        "Verbatim transcript was truncated due to meeting length. Please review the structured minutes.",
      minutes: resultText,
    };
  }
}

async function generateContentForModel(model: string, audioPart: any, prompt: string) {
  try {
    return await callWithRetry(() =>
      ai.models.generateContent({
        model,
        contents: [audioPart, prompt],
        config: {
          responseMimeType: "application/json",
          thinkingConfig: thinkingConfigForModel(model),
          httpOptions: { timeout: 900000 },
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcript: {
                type: Type.STRING,
                description:
                  "Fully-translated English transcript of the meeting (100% English). Prefer compact speaker/topic sections; omit filler and repeated acknowledgements. If the recording truly has no human speech, return '[No intelligible speech detected in the recording. Please check your microphone, ensure you are speaking clearly, and try recording again.]'.",
              },
              minutes: {
                type: Type.STRING,
                description:
                  "Polished structured meeting minutes in Markdown (100% English). Keep sections concise. If no speech was detected, return a brief Markdown note that no speech could be detected.",
              },
            },
            required: ["transcript", "minutes"],
          },
        },
      })
    );
  } catch (err: any) {
    const msg = errorText(err);
    if (!/thinking|ThinkingConfig|thinkingLevel|thinkingBudget/i.test(msg)) throw err;
    console.warn(`⚠️ Model ${model} rejected thinking config; retrying without it...`);
    return await callWithRetry(() =>
      ai.models.generateContent({
        model,
        contents: [audioPart, prompt],
        config: {
          responseMimeType: "application/json",
          httpOptions: { timeout: 900000 },
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcript: { type: Type.STRING },
              minutes: { type: Type.STRING },
            },
            required: ["transcript", "minutes"],
          },
        },
      })
    );
  }
}

async function generateWithModelFallback(opts: {
  audioPart: any;
  prompt: string;
  audioBytes: number;
}): Promise<{ transcript: string; minutes: string; modelUsed: string; noSpeechDetected: boolean }> {
  let lastError: any;
  let lastNoSpeech: {
    transcript: string;
    minutes: string;
    modelUsed: string;
    noSpeechDetected: true;
  } | null = null;

  let activePrompt = opts.prompt;
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const model = GEMINI_MODELS[i];
    try {
      console.log(`Calling Gemini generateContent with model=${model} (speed-optimized thinking)...`);
      const response = await generateContentForModel(model, opts.audioPart, activePrompt);
      const resultText = response.text;
      if (!resultText) {
        throw new Error("Gemini returned empty transcription results.");
      }
      const parsed = parseMinutesJson(resultText);
      const noSpeech = isNoSpeechResult(parsed.transcript, parsed.minutes);

      // Lite models often false-negative on browser webm; escalate on sizable files.
      if (noSpeech && opts.audioBytes >= NO_SPEECH_ESCALATE_BYTES && i < GEMINI_MODELS.length - 1) {
        console.warn(
          `⚠️ Model ${model} reported no speech on ${opts.audioBytes} byte file — escalating to next model...`
        );
        lastNoSpeech = {
          transcript: parsed.transcript,
          minutes: parsed.minutes,
          modelUsed: model,
          noSpeechDetected: true,
        };
        activePrompt = `${opts.prompt}

SECOND-PASS CHECK (${opts.audioBytes} bytes): This is a real browser/upload recording. WebM/Opus audio can sound quiet or compressed. Listen carefully for any human speech in ANY language (including quiet, accented, distant, or overlapping talk). Do NOT use the no-speech template unless you are certain there is zero human speech. Transcribe and translate whatever speech you can hear.`;
        continue;
      }

      console.log(`✅ Gemini minutes generated with model=${model}${noSpeech ? " (no speech)" : ""}`);
      return {
        transcript: parsed.transcript,
        minutes: parsed.minutes,
        modelUsed: model,
        noSpeechDetected: noSpeech,
      };
    } catch (err: any) {
      lastError = err;
      if (shouldTryNextModel(err)) {
        console.warn(
          `⚠️ Model ${model} failed (${failoverReason(err)}). Trying next fallback if any...`
        );
        continue;
      }
      throw err;
    }
  }

  if (lastNoSpeech) {
    console.warn("All models reported no speech on a sizable file; returning last no-speech result.");
    return lastNoSpeech;
  }
  const exhausted = lastError || new Error("All Gemini model fallbacks failed.");
  (exhausted as any).triedModels = [...GEMINI_MODELS];
  throw exhausted;
}

async function notifyMeetingWebhook(payload: Record<string, unknown>) {
  const url = process.env.MEETING_WEBHOOK_URL?.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, at: new Date().toISOString() }),
    });
  } catch (e: any) {
    console.warn("MEETING_WEBHOOK_URL notify failed:", e.message);
  }
}

async function deleteMeetingAssets(meeting: any) {
  if (meeting?.audioStoragePath && storageBucketName) {
    try {
      await getStorage().bucket(storageBucketName).file(meeting.audioStoragePath).delete({ ignoreNotFound: true });
    } catch (e: any) {
      console.warn("Storage delete failed:", e.message);
    }
  }
  if (meeting?.audioLocalRelativePath) {
    try {
      const local = path.join(process.cwd(), meeting.audioLocalRelativePath);
      if (fs.existsSync(local)) fs.unlinkSync(local);
    } catch (e: any) {
      console.warn("Local recording delete failed:", e.message);
    }
  }
}

async function deleteMeetingById(meetingId: string, userId: string): Promise<boolean> {
  const meeting = await getMeetingById(meetingId);
  if (!meeting || meeting.userId !== userId) return false;
  await deleteMeetingAssets(meeting);
  if (isUsingFallbackDb) {
    const db = loadLocalDb();
    delete db.meetings[meetingId];
    saveLocalDb(db);
    return true;
  }
  if (!fdb) return false;
  await fdb.collection("meetings").doc(meetingId).delete();
  return true;
}

async function getSignedAudioDownloadUrl(meeting: any): Promise<string | null> {
  if (!meeting?.audioStoragePath || !storageBucketName) return null;
  const [url] = await getStorage()
    .bucket(storageBucketName)
    .file(meeting.audioStoragePath)
    .getSignedUrl({
      action: "read",
      expires: Date.now() + 15 * 60 * 1000,
      responseDisposition: `attachment; filename="${(meeting.title || "recording").replace(/[^\w.-]+/g, "_").slice(0, 80)}.webm"`,
    });
  return url;
}

function audioDownloadFilename(meeting: any): string {
  return `${(meeting.title || "recording").replace(/[^\w.-]+/g, "_").slice(0, 80)}.webm`;
}

/** Soft-expire archived audio older than retention days (keeps minutes text). */
async function expireOldRecordingsForUser(userId: string) {
  const cutoff = Date.now() - RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const markExpired = async (id: string, meeting: any) => {
    const created = meeting.createdAt?._seconds
      ? meeting.createdAt._seconds * 1000
      : new Date(meeting.createdAt || 0).getTime();
    if (!Number.isFinite(created) || created > cutoff) return;
    if (!meeting.audioStoragePath && !meeting.audioLocalRelativePath) return;
    await deleteMeetingAssets(meeting);
    await updateMeetingInDb(id, {
      audioStoragePath: "",
      audioLocalRelativePath: "",
      hasAudio: false,
      audioExpiredAt: new Date().toISOString(),
    });
  };

  if (isUsingFallbackDb) {
    const db = loadLocalDb();
    for (const [id, meeting] of Object.entries(db.meetings)) {
      if ((meeting as any).userId === userId) await markExpired(id, meeting);
    }
    return;
  }
  if (!fdb) return;
  const snap = await fdb.collection("meetings").where("userId", "==", userId).get();
  for (const doc of snap.docs) {
    await markExpired(doc.id, { id: doc.id, ...doc.data() });
  }
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
  app.get("/api/health", async (req, res) => {
    const geminiConfigured = !!process.env.GEMINI_API_KEY?.trim();
    const build = readBuildMeta();
    let storageOk: boolean | null = null;
    let storageError: string | null = null;
    if (storageBucketName) {
      try {
        const [exists] = await getStorage().bucket(storageBucketName).exists();
        storageOk = !!exists;
        if (!exists) storageError = "Bucket does not exist or is inaccessible";
      } catch (e: any) {
        storageOk = false;
        storageError = e.message || "Storage probe failed";
      }
    }
    res.json({
      status: "ok",
      serverOnline: true,
      geminiConfigured,
      geminiModel: GEMINI_MODEL,
      processingModel: GEMINI_MODEL,
      geminiModelFallbacks: GEMINI_MODELS,
      storageConfigured: !!storageBucketName,
      storageOk,
      storageError,
      recordingRetentionDays: RECORDING_RETENTION_DAYS,
      freeRedoHours: FREE_REDO_HOURS,
      usingFallbackDb: isUsingFallbackDb,
      buildId: build.buildId || null,
      builtAt: build.builtAt || null,
      environment: isProduction ? "production" : "development",
    });
  });

  // Live probe: tries primary then fallbacks (same order as minutes generation).
  app.get("/api/gemini-probe", async (_req, res) => {
    if (!process.env.GEMINI_API_KEY?.trim()) {
      return res.status(503).json({
        ok: false,
        model: GEMINI_MODEL,
        error: "GEMINI_API_KEY is not configured",
      });
    }
    const tried: Array<{ model: string; ok: boolean; error?: string }> = [];
    for (const model of GEMINI_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: "Reply with the single word OK.",
        });
        const text = (response.text || "").trim();
        tried.push({ model, ok: true });
        return res.json({
          ok: true,
          model,
          reply: text.slice(0, 80),
          tried,
        });
      } catch (err: any) {
        tried.push({ model, ok: false, error: formatGeminiError(err, model) });
        if (!shouldTryNextModel(err)) {
          return res.status(500).json({ ok: false, model, error: formatGeminiError(err, model), tried });
        }
      }
    }
    return res.status(503).json({
      ok: false,
      model: GEMINI_MODEL,
      error: "All Gemini model fallbacks failed",
      tried,
    });
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
      const userId = resolveAuthedUserId(req as AuthedRequest) || (req.query.userId as string);
      if (!userId) {
        return res.status(400).json({ error: "Missing userId" });
      }

      // Soft-expire old archived audio (async; failures shouldn't block history)
      expireOldRecordingsForUser(userId).catch((e) =>
        console.warn("expireOldRecordingsForUser failed:", e?.message || e)
      );

      if (isUsingFallbackDb) {
        const db = loadLocalDb();
        const meetings = Object.values(db.meetings)
          .filter((m: any) => m.userId === userId)
          .map((m: any) => ({
            ...m,
            freeRedoEligible: isFreeRedoEligible(m),
            recordingRetentionDays: RECORDING_RETENTION_DAYS,
          }))
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

      const meetings = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
          freeRedoEligible: isFreeRedoEligible(data),
          recordingRetentionDays: RECORDING_RETENTION_DAYS,
        };
      });

      res.json(meetings);
    } catch (error: any) {
      console.error("Error fetching meetings history:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Prefer signed URL; fall back to authenticated proxy stream (avoids signBlob IAM issues).
  app.get("/api/meetings/:meetingId/audio-url", verifyFirebaseAuth, requireUserMatch, async (req, res) => {
    try {
      const userId = resolveAuthedUserId(req as AuthedRequest);
      const meetingId = req.params.meetingId;
      if (!userId) return res.status(400).json({ error: "Missing userId" });
      const meeting = await getMeetingById(meetingId);
      if (!meeting || meeting.userId !== userId) {
        return res.status(404).json({ error: "Meeting not found" });
      }
      const hasArchive = !!(meeting.audioStoragePath || meeting.audioLocalRelativePath);
      if (!hasArchive) {
        return res.status(404).json({ error: "No archived recording available for download." });
      }

      if (meeting.audioStoragePath && storageBucketName) {
        try {
          const url = await getSignedAudioDownloadUrl(meeting);
          if (url) {
            return res.json({ url, expiresInSeconds: 900, local: false });
          }
        } catch (signErr: any) {
          console.warn("Signed URL unavailable, using proxy stream:", signErr?.message || signErr);
        }
      }

      // Auth-gated stream works for Storage and local archives without signBlob.
      return res.json({
        url: `/api/meetings/${meetingId}/audio-file`,
        expiresInSeconds: 900,
        local: true,
      });
    } catch (error: any) {
      console.error("audio-url failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Stream archived audio (local disk or Cloud Storage) through the API
  app.get("/api/meetings/:meetingId/audio-file", verifyFirebaseAuth, requireUserMatch, async (req, res) => {
    try {
      const userId = resolveAuthedUserId(req as AuthedRequest);
      const meetingId = req.params.meetingId;
      if (!userId) return res.status(400).json({ error: "Missing userId" });
      const meeting = await getMeetingById(meetingId);
      if (!meeting || meeting.userId !== userId) {
        return res.status(404).json({ error: "Meeting not found" });
      }

      const filename = audioDownloadFilename(meeting);
      res.setHeader("Content-Type", meeting.audioMimeType || "audio/webm");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      if (meeting.audioStoragePath && storageBucketName) {
        const file = getStorage().bucket(storageBucketName).file(meeting.audioStoragePath);
        const [exists] = await file.exists();
        if (!exists) return res.status(404).json({ error: "Recording missing from Storage" });
        file.createReadStream()
          .on("error", (err) => {
            console.error("audio-file storage stream failed:", err);
            if (!res.headersSent) res.status(500).json({ error: "Download stream failed" });
            else res.end();
          })
          .pipe(res);
        return;
      }

      if (!meeting.audioLocalRelativePath) {
        return res.status(404).json({ error: "Local recording not found" });
      }
      const local = path.join(process.cwd(), meeting.audioLocalRelativePath);
      if (!fs.existsSync(local)) return res.status(404).json({ error: "File missing" });
      fs.createReadStream(local).pipe(res);
    } catch (error: any) {
      console.error("audio-file failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete meeting (Firestore + Storage + local archive)
  app.delete("/api/meetings/:meetingId", verifyFirebaseAuth, requireUserMatch, async (req, res) => {
    try {
      const userId = resolveAuthedUserId(req as AuthedRequest);
      const meetingId = req.params.meetingId;
      if (!userId) return res.status(400).json({ error: "Missing userId" });
      const ok = await deleteMeetingById(meetingId, userId);
      if (!ok) return res.status(404).json({ error: "Meeting not found" });
      res.json({ success: true, deleted: meetingId });
    } catch (error: any) {
      console.error("delete meeting failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Bulk delete selected meetings, or clear entire history for the user
  app.post("/api/meetings/bulk-delete", verifyFirebaseAuth, requireUserMatch, async (req, res) => {
    try {
      const userId = resolveAuthedUserId(req as AuthedRequest);
      if (!userId) return res.status(400).json({ error: "Missing userId" });

      const clearAll = !!req.body?.clearAll;
      let meetingIds: string[] = Array.isArray(req.body?.meetingIds)
        ? req.body.meetingIds.map((id: unknown) => String(id)).filter(Boolean)
        : [];

      if (clearAll) {
        if (isUsingFallbackDb) {
          const db = loadLocalDb();
          meetingIds = Object.values(db.meetings)
            .filter((m: any) => m.userId === userId)
            .map((m: any) => m.id);
        } else if (fdb) {
          const snap = await fdb.collection("meetings").where("userId", "==", userId).get();
          meetingIds = snap.docs.map((d) => d.id);
        } else {
          meetingIds = [];
        }
      }

      // Cap accidental huge deletes in one request
      meetingIds = [...new Set(meetingIds)].slice(0, 500);
      if (meetingIds.length === 0) {
        return res.json({ success: true, deleted: [], deletedCount: 0 });
      }

      const deleted: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];
      for (const id of meetingIds) {
        try {
          const ok = await deleteMeetingById(id, userId);
          if (ok) deleted.push(id);
          else failed.push({ id, error: "Not found or not owned" });
        } catch (e: any) {
          failed.push({ id, error: e?.message || String(e) });
        }
      }

      res.json({
        success: failed.length === 0,
        clearAll,
        deleted,
        deletedCount: deleted.length,
        failed,
      });
    } catch (error: any) {
      console.error("bulk-delete meetings failed:", error);
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

        const userId = resolveAuthedUserId(req as AuthedRequest);
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
    clientDateTime,
    retainOriginal = false,
  }: {
    filePath: string;
    mimeType: string;
    title: string;
    clientDateTime?: string;
    /** When true, keep the source recording on disk (for redo / archive). */
    retainOriginal?: boolean;
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

      const buildInlineAudioPart = () => {
        console.log(
          `Using inlineData for file ${activeFilePath} with size ${activeStats.size} bytes...`
        );
        const base64Data = fs.readFileSync(activeFilePath).toString("base64");
        return {
          inlineData: {
            mimeType: activeMimeType,
            data: base64Data,
          },
        };
      };

      // Files API uploads are flaky on App Hosting (multipart fetch failures). Prefer
      // inline for anything under 20MB — that path works reliably for redo/generate.
      if (activeStats.size < 20 * 1024 * 1024) {
        audioPart = buildInlineAudioPart();
      } else {
        try {
          console.log(
            `Uploading large file via Gemini Files API (${activeMimeType}, ${activeStats.size} bytes)...`
          );
          uploadedFile = await callWithRetry(() =>
            ai.files.upload({
              file: activeFilePath,
              mimeType: activeMimeType,
            } as any)
          );

          console.log(`Waiting for Gemini to process the audio file... File Name: ${uploadedFile.name}`);
          let fileState = uploadedFile.state;
          while (fileState === "PROCESSING") {
            await new Promise((resolve) => setTimeout(resolve, 1000));
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
              mimeType: uploadedFile.mimeType || activeMimeType,
            },
          };
        } catch (filesErr: any) {
          console.warn(
            "Gemini Files API failed for large audio; cannot fall back to inline (>20MB):",
            filesErr?.message || filesErr
          );
          throw filesErr;
        }
      }

      console.log("Audio file processed. Generating English transcript and meeting minutes...");

      const dateToUse = clientDateTime || new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

      const prompt = `You are an expert meeting transcriptionist and executive assistant.
From the attached audio, return JSON with:
1) transcript — concise English transcript (translate any non-English speech; omit filler)
2) minutes — English Markdown minutes with: Title (${title}), Date & Time (${dateToUse}), Executive Summary, Attendees/Speakers, Key Discussion Points, Decisions Made, Action Items

Rules:
- Use ONLY spoken content. Do not invent facts.
- Empty sections → "None discussed"
- Quiet/compressed WebM audio still has speech — transcribe it. Non-English ≠ no speech.
- True silence/noise only → transcript exactly "[No intelligible speech detected in the recording. Please check your microphone, ensure you are speaking clearly, and try recording again.]" and minutes "### No Speech Detected\\n\\nNo intelligible spoken words or discussion could be detected in the provided audio recording. As a result, no meeting minutes could be generated. Please make sure your microphone is active and you are speaking clearly during the recording."
Keep answers tight and fast.`;

      const generated = await generateWithModelFallback({
        audioPart,
        prompt,
        audioBytes: activeStats.size,
      });

      return {
        success: true,
        transcript: generated.transcript,
        minutes: generated.minutes,
        noSpeechDetected: generated.noSpeechDetected,
        modelUsed: generated.modelUsed,
      };
    } finally {
      // Clean up original local temp file unless caller wants to archive it
      if (!retainOriginal) {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          console.error("Cleanup error for raw path:", e);
        }
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
        const userId = resolveAuthedUserId(req as AuthedRequest);

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
          clientDateTime,
          retainOriginal: true,
        });

        if (result.success) {
          const noSpeech = !!(result as any).noSpeechDetected;
          let creditCharged = false;
          let creditsRemaining = credits;

          const audioMeta = await persistRecording({
            sourcePath: filePath,
            userId,
            meetingId,
            mimeType: (mimeType || "audio/webm").split(";")[0].trim().toLowerCase(),
          });

          // Remove the original temp upload if it was copied into recordings/
          try {
            const archivedAbs = path.join(process.cwd(), audioMeta.audioLocalRelativePath);
            if (path.resolve(filePath) !== path.resolve(archivedAbs) && fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (e) {
            console.warn("Could not remove temp upload after archive:", e);
          }

          // Save meeting record in Firestore
          const freeRedoUntil = !noSpeech ? freeRedoUntilFromNow() : undefined;
          const savedMeeting = await saveMeetingToDb({
            id: meetingId,
            userId,
            title,
            duration: 0,
            language: "Detected",
            summary: result.minutes ? result.minutes.split("\n")[0].substring(0, 300) : "",
            minutes: result.minutes || "",
            transcript: result.transcript || "",
            actionItems: result.minutes ? "Extracted in meeting minutes." : "",
            status: noSpeech ? "no_speech" : "processed",
            ...(freeRedoUntil ? { freeRedoUntil } as any : {}),
            ...audioMeta,
          });

          // Charge only after archive + DB write succeed
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

          await notifyMeetingWebhook({
            event: "minutes_ready",
            meetingId,
            userId,
            title,
            creditCharged,
            modelUsed: (result as any).modelUsed || GEMINI_MODEL,
          });

          return res.json({
            ...result,
            meeting: savedMeeting,
            meetingCreditsRemaining: creditsRemaining,
            creditCharged,
            noSpeechDetected: noSpeech,
            freeRedoUntil: freeRedoUntil || null,
            freeRedoHours: FREE_REDO_HOURS,
          });
        }

        // Processing failed — still drop the temp file
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {
          // ignore
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
          error: formatGeminiError(error, GEMINI_MODEL),
          model: GEMINI_MODEL,
          message: /fetch failed|Timeout|UND_ERR/i.test(String(error?.message || error))
            ? "Could not reach the AI service (temporary network issue). Please try Generate again in a few seconds."
            : error?.message || formatGeminiError(error, GEMINI_MODEL),
        });
      }
    }
  );

  // Save recording to history WITHOUT generating minutes (free). Redo later for 1 credit.
  app.post(
    "/api/recording/save",
    express.raw({ type: "*/*", limit: "500mb" }),
    verifyFirebaseAuth,
    requireUserMatch,
    async (req, res) => {
      try {
        const clientDateTime = req.query.clientDateTime as string;
        const title =
          (req.query.title as string) ||
          (clientDateTime ? `Meeting on ${clientDateTime}` : `Saved Recording ${new Date().toLocaleDateString()}`);
        const mimeType = (req.query.mimeType as string) || "audio/webm";
        const durationSec = parseInt(String(req.query.duration || "0"), 10) || 0;
        const userId = resolveAuthedUserId(req as AuthedRequest);

        if (!userId) {
          return res.status(400).json({ error: "User ID is required to save a recording." });
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
              "Recording too short / no audio captured. Please record for at least a few seconds before saving.",
          });
        }

        const meetingId = `saved_${Date.now()}`;
        let extension = "webm";
        if (mimeType.includes("mp3") || mimeType.includes("mpeg")) extension = "mp3";
        else if (mimeType.includes("wav")) extension = "wav";
        else if (mimeType.includes("ogg")) extension = "ogg";
        else if (mimeType.includes("m4a") || mimeType.includes("aac")) extension = "m4a";
        else if (mimeType.includes("mp4")) extension = "mp4";

        const filePath = path.join(process.cwd(), "uploads", `meeting-${meetingId}.${extension}`);
        console.log(`Saving recording only (no minutes yet): ${filePath} (${bodyLen} bytes)`);
        fs.writeFileSync(filePath, req.body);

        const audioMeta = await persistRecording({
          sourcePath: filePath,
          userId,
          meetingId,
          mimeType: mimeType.split(";")[0].trim().toLowerCase(),
        });

        try {
          const archivedAbs = path.join(process.cwd(), audioMeta.audioLocalRelativePath);
          if (path.resolve(filePath) !== path.resolve(archivedAbs) && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          console.warn("Could not remove temp file after save-only archive:", e);
        }

        const savedMeeting = await saveMeetingToDb({
          id: meetingId,
          userId,
          title,
          duration: durationSec,
          language: "Pending",
          summary: `Recording saved — generate minutes when ready. Audio kept up to ${RECORDING_RETENTION_DAYS} days.`,
          minutes: "",
          transcript: "",
          actionItems: "",
          status: "saved",
          ...audioMeta,
        });

        return res.json({
          success: true,
          savedOnly: true,
          meeting: savedMeeting,
          recordingRetentionDays: RECORDING_RETENTION_DAYS,
          message: `Recording saved to history (kept up to ${RECORDING_RETENTION_DAYS} days). First Generate costs 1 credit; Redo is free for ${FREE_REDO_HOURS}h after that.`,
        });
      } catch (error: any) {
        console.error("Save-only recording failed:", error);
        res.status(500).json({ error: error.message || "Failed to save recording." });
      }
    }
  );

  // Stop recording and process meeting audio
  app.post("/api/recording/stop", verifyFirebaseAuth, requireUserMatch, async (req, res) => {
    const { meetingId, title, clientDateTime } = req.body || {};
    const userId = resolveAuthedUserId(req as AuthedRequest);

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
        clientDateTime,
        retainOriginal: true,
      });

      if (result.success) {
        const noSpeech = !!(result as any).noSpeechDetected;
        let creditCharged = false;
        let creditsRemaining = credits;

        const meetingDocId = `meeting_${meetingId}`;
        const audioMeta = await persistRecording({
          sourcePath: filePath,
          userId,
          meetingId: meetingDocId,
          mimeType: "audio/webm",
        });

        try {
          const archivedAbs = path.join(process.cwd(), audioMeta.audioLocalRelativePath);
          if (path.resolve(filePath) !== path.resolve(archivedAbs) && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          console.warn("Could not remove temp recording after archive:", e);
        }

        // Save meeting record in Firestore
        const freeRedoUntil = !noSpeech ? freeRedoUntilFromNow() : undefined;
        const savedMeeting = await saveMeetingToDb({
          id: meetingDocId,
          userId,
          title: title || `Meeting on ${new Date().toLocaleDateString()}`,
          duration: 0,
          language: "Detected",
          summary: result.minutes ? result.minutes.split("\n")[0].substring(0, 300) : "",
          minutes: result.minutes || "",
          transcript: result.transcript || "",
          actionItems: result.minutes ? "Extracted in meeting minutes." : "",
          status: noSpeech ? "no_speech" : "processed",
          ...(freeRedoUntil ? { freeRedoUntil } as any : {}),
          ...audioMeta,
        });

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

        await notifyMeetingWebhook({
          event: "minutes_ready",
          meetingId: meetingDocId,
          userId,
          title: title || savedMeeting?.title,
          creditCharged,
          modelUsed: (result as any).modelUsed || GEMINI_MODEL,
        });

        return res.json({
          ...result,
          meeting: savedMeeting,
          meetingCreditsRemaining: creditsRemaining,
          creditCharged,
          noSpeechDetected: noSpeech,
          freeRedoUntil: freeRedoUntil || null,
          freeRedoHours: FREE_REDO_HOURS,
        });
      }

      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore
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
        error: formatGeminiError(error, GEMINI_MODEL),
        model: GEMINI_MODEL,
        message: /fetch failed|Timeout|UND_ERR/i.test(String(error?.message || error))
          ? "Could not reach the AI service (temporary network issue). Please try Generate again in a few seconds."
          : error?.message || formatGeminiError(error, GEMINI_MODEL),
      });
    }
  });

  // Re-run meeting minutes from a previously saved recording
  app.post("/api/meetings/reprocess", verifyFirebaseAuth, requireUserMatch, async (req, res) => {
    const { meetingId, clientDateTime } = req.body || {};
    const userId = resolveAuthedUserId(req as AuthedRequest);

    if (!meetingId) {
      return res.status(400).json({ error: "Missing meetingId" });
    }
    if (!userId) {
      return res.status(400).json({ error: "User ID is required to reprocess a meeting." });
    }

    try {
      const meeting = await getMeetingById(meetingId);
      if (!meeting) {
        return res.status(404).json({ error: "Meeting not found." });
      }
      if (meeting.userId !== userId) {
        return res.status(403).json({ error: "Forbidden", message: "This meeting does not belong to your account." });
      }
      if (!meeting.audioStoragePath && !meeting.audioLocalRelativePath) {
        return res.status(400).json({
          error: "NO_SAVED_RECORDING",
          message:
            "No saved recording for this meeting. Redo is only available for meetings processed after recording-save was enabled.",
        });
      }

      const profile = await getUserProfile(userId);
      const credits = profile?.meetingCredits || 0;
      const freeRedo = isFreeRedoEligible(meeting);
      // Free Redo only after a paid generate opened the window (freeRedoUntil).
      if (!freeRedo && credits <= 0) {
        return res.status(403).json({
          error: "INSUFFICIENT_CREDITS",
          message: "No Meeting Credits Remaining. Purchase one Meeting Credit (RM39) to generate/redo minutes.",
        });
      }

      const material = await materializeRecording(meeting);
      try {
        const result = await handleAudioProcessing({
          filePath: material.filePath,
          mimeType: material.mimeType,
          title: meeting.title || `Meeting on ${new Date().toLocaleDateString()}`,
          clientDateTime: clientDateTime || undefined,
          // Keep archived / downloaded files as needed; temp downloads cleaned below.
          retainOriginal: !material.cleanupTemp,
        });

        if (!result.success) {
          return res.status(500).json({ error: "Failed to regenerate meeting minutes." });
        }

        const noSpeech = !!(result as any).noSpeechDetected;
        let creditCharged = false;
        let creditsRemaining = credits;
        const nextFreeRedoUntil = !noSpeech
          ? freeRedoUntilFromNow()
          : meeting.freeRedoUntil || null;

        const updated = await updateMeetingInDb(meetingId, {
          minutes: result.minutes || "",
          transcript: result.transcript || "",
          summary: result.minutes ? result.minutes.split("\n")[0].substring(0, 300) : "",
          actionItems: result.minutes ? "Extracted in meeting minutes." : "",
          status: noSpeech ? "no_speech" : "processed",
          hasAudio: true,
          ...(nextFreeRedoUntil ? { freeRedoUntil: nextFreeRedoUntil } : {}),
          lastReprocessedAt: new Date().toISOString(),
        });

        // Charge unless this is a free redo within the window (and not no-speech)
        if (!noSpeech && !freeRedo) {
          const creditDeducted = await deductCredit(userId);
          if (creditDeducted) {
            creditCharged = true;
            creditsRemaining = credits - 1;
            console.log(`Deducted 1 credit from user ${userId} for meeting reprocess.`);
          }
        } else if (!noSpeech && freeRedo) {
          console.log(`Free redo within ${FREE_REDO_HOURS}h window for meeting ${meetingId}.`);
        } else {
          console.log(`Skipping credit deduction for reprocess (${meetingId}): no speech detected.`);
        }

        await notifyMeetingWebhook({
          event: "minutes_reprocessed",
          meetingId,
          userId,
          title: meeting.title,
          creditCharged,
          freeRedo,
          modelUsed: (result as any).modelUsed || GEMINI_MODEL,
        });

        return res.json({
          ...result,
          meeting: updated,
          meetingCreditsRemaining: creditsRemaining,
          creditCharged,
          noSpeechDetected: noSpeech,
          reprocessed: true,
          freeRedo,
          freeRedoUntil: nextFreeRedoUntil,
          freeRedoHours: FREE_REDO_HOURS,
        });
      } finally {
        if (material.cleanupTemp) {
          try {
            if (fs.existsSync(material.filePath)) fs.unlinkSync(material.filePath);
          } catch {
            // ignore
          }
        }
      }
    } catch (error: any) {
      console.error("Meeting reprocess failed:", error);
      const friendly = formatGeminiError(error, GEMINI_MODEL);
      res.status(500).json({
        error: friendly,
        model: GEMINI_MODEL,
        message: friendly,
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
