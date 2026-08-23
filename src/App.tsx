import React, { useState, useEffect, useRef } from "react";
import {
  Mic,
  Square,
  History,
  Loader2,
  Sparkles,
  Trash2,
  FileDown,
  Globe,
  Upload,
  AlertCircle,
  CreditCard,
  Shield,
  LogOut,
  RefreshCw,
  Save,
  Download,
  CheckSquare,
  Volume2,
  Pause,
  Moon,
  Sun,
  Monitor,
} from "lucide-react";
import { DashboardLayout, type DashboardTab } from "./components/DashboardLayout";
import { Toast } from "./components/Toast";
import { BuyCreditsSection } from "./components/BuyCreditsSection";
import { LandingPricing } from "./components/LandingPricing";
import { InstallAppPrompt } from "./components/InstallAppPrompt";
import { LegalModal, LegalLinks, AiDisclaimer, type LegalDocType } from "./components/LegalModal";
import { OperationManualModal, ManualLink } from "./components/OperationManualModal";
import { RecordUploadPage } from "./components/RecordUploadPage";
import { ScrollDownHint } from "./components/ScrollDownHint";
import {
  applyTheme,
  readThemePreference,
  setThemePreference,
  type ThemePreference,
} from "./theme";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from "firebase/auth";
import {
  buildSpeechCacheKey,
  clearSpeechCache,
  getSpeechCache,
  invalidateSpeechCacheForMeeting,
  setSpeechCache,
  type SpeechTab,
} from "./utils/speechMemoryCache";
import {
  isDeveloperEmail,
  UNLIMITED_CREDITS_SENTINEL,
} from "./developerAllowlist";

/** Web-audio boost applied before MediaRecorder (quiet / distant mics). */
const MIC_GAIN_BOOST = 2.8;
/** Meter threshold for “Voice detected” (0–1). */
const MIC_VOICE_THRESHOLD = 0.035;

const DISPLAY_GEMINI_MODEL = "Gemini 3.5 Flash";

/** Minimum usable capture before we bother uploading / charging. */
const MIN_RECORDING_SECONDS = 3;
/** WebM headers alone can exceed 2KB — require a bit more for live captures. */
const MIN_AUDIO_BYTES = 4096;
/** Meeting minutes/transcripts are produced in English. */
const SPEECH_SOURCE_LANG = "en";

function normalizeSpeechLang(lang?: string | null): string {
  return (lang || "en").toLowerCase().split("-")[0] || "en";
}

function getBrowserSpeechLang(): string {
  if (typeof navigator === "undefined") return "en";
  return normalizeSpeechLang(navigator.language);
}

function formatGeminiModelLabel(_modelId?: string | null): string {
  // Always show 3.5 — never surface a stale 1.5 label from old health payloads or caches.
  return DISPLAY_GEMINI_MODEL;
}

function getTimeBasedGreeting(displayName?: string | null): string {
  const hour = new Date().getHours();
  const period = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = displayName?.trim().split(/\s+/)[0];
  return firstName ? `${period}, ${firstName}` : period;
}

function isNoSpeechContent(transcript?: string | null, minutes?: string | null): boolean {
  const blob = `${transcript || ""}\n${minutes || ""}`.toLowerCase();
  return (
    blob.includes("no intelligible speech") ||
    blob.includes("no speech detected") ||
    blob.includes("### no speech detected")
  );
}

/** Strip Markdown / noise so TTS reads minutes naturally. */
function plainTextForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\|/g, ", ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkTextForSpeech(text: string, maxLen = 180): string[] {
  const cleaned = plainTextForSpeech(text);
  if (!cleaned) return [];
  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];
  const chunks: string[] = [];
  let buf = "";
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if ((buf + " " + part).trim().length <= maxLen) {
      buf = (buf + " " + part).trim();
    } else {
      if (buf) chunks.push(buf);
      if (part.length <= maxLen) {
        buf = part;
      } else {
        for (let i = 0; i < part.length; i += maxLen) {
          chunks.push(part.slice(i, i + maxLen));
        }
        buf = "";
      }
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

const CREDIT_PRICE_RM = 29;
const packagePriceRm = (credits: number) => {
  if (credits === 1) return 29;
  if (credits === 5) return 101.5; // 30% off RM145
  if (credits === 10) return 174; // 40% off RM290
  return credits * CREDIT_PRICE_RM;
};
const creditsToPackageId = (credits: number): string | null => {
  if (credits === 1) return "credits_1";
  if (credits === 5) return "credits_5";
  if (credits === 10) return "credits_10";
  return null;
};
const formatPackagePrice = (credits: number) => {
  const price = packagePriceRm(credits);
  return Number.isInteger(price) ? `RM${price}` : `RM${price.toFixed(2)}`;
};
const formatPackagePriceDecimal = (credits: number) => `RM ${packagePriceRm(credits).toFixed(2)}`;

interface MeetingItem {
  meetingId: string;
  title: string;
  date: string;
  duration: string; // in seconds formatted as hh:mm:ss
  transcript: string;
  minutes: string;
  /** True when a recording was archived for redo. */
  hasAudio?: boolean;
  /** e.g. saved | processed */
  status?: string;
  freeRedoEligible?: boolean;
  freeRedoUntil?: string | null;
}

// Local cache for meeting history (per signed-in user — server remains source of truth)
const HISTORY_KEY_LEGACY = "meeting_minutes_history";
const historyStorageKey = (uid: string) => `meeting_minutes_history:${uid}`;

function readCachedHistory(uid: string): MeetingItem[] | null {
  try {
    const raw = localStorage.getItem(historyStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedHistory(uid: string, items: MeetingItem[]) {
  try {
    localStorage.setItem(historyStorageKey(uid), JSON.stringify(items));
    localStorage.removeItem(HISTORY_KEY_LEGACY);
  } catch {
    // quota / private mode — ignore
  }
}

function clearCachedHistory(uid?: string | null) {
  try {
    if (uid) localStorage.removeItem(historyStorageKey(uid));
    localStorage.removeItem(HISTORY_KEY_LEGACY);
  } catch {
    // ignore
  }
}

interface PendingRecording {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  durationLabel: string;
  title: string;
}

// Simple inline parser for markdown bold text
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

// Lightweight Markdown Renderer to render headers, bullet lists, numbered lists, and bold text beautifully
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  if (!content) return null;

  // Split by double newline to detect block-level elements
  const blocks = content.split(/\n\s*\n/);

  return (
    <div className="space-y-4">
      {blocks.map((block, idx) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        // Headers
        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={idx} className="text-sm font-semibold text-blue-600 uppercase tracking-wider mt-5 mb-1.5 font-sans">
              {renderInlineMarkdown(trimmed.substring(4))}
            </h4>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h3 key={idx} className="text-lg font-bold text-slate-900 tracking-tight border-b border-slate-200 pb-1 mt-6 mb-2 font-sans">
              {renderInlineMarkdown(trimmed.substring(3))}
            </h3>
          );
        }
        if (trimmed.startsWith("# ")) {
          return (
            <h2 key={idx} className="text-xl font-extrabold text-slate-900 tracking-tight mt-8 mb-3 font-sans">
              {renderInlineMarkdown(trimmed.substring(2))}
            </h2>
          );
        }

        // Horizontal Rules
        if (trimmed === "---" || trimmed === "***") {
          return <hr key={idx} className="border-slate-200 my-4" />;
        }

        // Bullet lists
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
          // Split by newline containing list start
          const items = trimmed.split(/\n\s*[-*•]\s+/);
          return (
            <ul key={idx} className="list-disc pl-5 space-y-2 text-sm sm:text-base text-slate-700 leading-relaxed font-sans">
              {items.map((item, i) => {
                let itemText = item;
                if (i === 0) {
                  itemText = item.replace(/^[-*•]\s+/, "");
                }
                return <li key={i}>{renderInlineMarkdown(itemText)}</li>;
              })}
            </ul>
          );
        }

        // Numbered lists
        if (/^\d+\.\s+/.test(trimmed)) {
          const items = trimmed.split(/\n\s*\d+\.\s+/);
          return (
            <ol key={idx} className="list-decimal pl-5 space-y-2 text-sm sm:text-base text-slate-700 leading-relaxed font-sans">
              {items.map((item, i) => {
                let itemText = item;
                if (i === 0) {
                  itemText = item.replace(/^\d+\.\s+/, "");
                }
                return <li key={i}>{renderInlineMarkdown(itemText)}</li>;
              })}
            </ol>
          );
        }

        // Standard Paragraph
        return (
          <p key={idx} className="text-sm sm:text-base text-slate-700 leading-relaxed font-sans">
            {renderInlineMarkdown(trimmed)}
          </p>
        );
      })}
    </div>
  );
};

export default function App() {
  // Auth state
  const [firebaseConfig, setFirebaseConfig] = useState<any>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [showTroubleshootModal, setShowTroubleshootModal] = useState(false);
  const [legalDocType, setLegalDocType] = useState<LegalDocType | null>(null);
  const [showOperationManual, setShowOperationManual] = useState(false);
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => readThemePreference());
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [redoingMeetingId, setRedoingMeetingId] = useState<string | null>(null);
  const [pendingRecording, setPendingRecording] = useState<PendingRecording | null>(null);
  const [isSavingRecording, setIsSavingRecording] = useState(false);

  // SaaS states
  const [copiedMinutes, setCopiedMinutes] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const [isReadAloudPaused, setIsReadAloudPaused] = useState(false);
  const [isPreparingSpeech, setIsPreparingSpeech] = useState(false);
  const speechQueueRef = useRef<string[]>([]);
  const viewingMeetingIdRef = useRef<string | null>(null);
  const speechLangRef = useRef<string>(getBrowserSpeechLang());
  const speechSupported =
    typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";

  // Subscription / Monetization states (Extended for credits)
  const [checkingOutPlan, setCheckingOutPlan] = useState<number | null>(null);
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [showSimulatedCheckout, setShowSimulatedCheckout] = useState(false);
  const [isProcessingSimulatedPayment, setIsProcessingSimulatedPayment] = useState(false);
  const [purchaseQuantity, setPurchaseQuantity] = useState<number>(1);

  // Credits & Dashboard states
  const [meetingCredits, setMeetingCredits] = useState<number>(0);
  const [unlimitedCredits, setUnlimitedCredits] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string>("none");
  const [paymentsHistory, setPaymentsHistory] = useState<any[]>([]);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardTab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const hasCredits = unlimitedCredits || meetingCredits > 0;

  const showNotification = (message: string, type: "success" | "error" | "info" = "info") => {
    setNotification({ message, type });
    // Auto-dismiss after 6 seconds
    setTimeout(() => {
      setNotification((prev) => prev?.message === message ? null : prev);
    }, 6000);
  };

  const stopReadAloud = () => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    speechQueueRef.current = [];
    setIsReadingAloud(false);
    setIsReadAloudPaused(false);
  };

  const speakNextChunk = () => {
    if (!speechSupported) return;
    const next = speechQueueRef.current.shift();
    if (!next) {
      setIsReadingAloud(false);
      setIsReadAloudPaused(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(next);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.lang = speechLangRef.current;
    utterance.onend = () => speakNextChunk();
    utterance.onerror = () => {
      // Abort (user cancel) should not surface as an error toast.
      if (speechQueueRef.current.length === 0) {
        setIsReadingAloud(false);
        setIsReadAloudPaused(false);
      } else {
        speakNextChunk();
      }
    };
    window.speechSynthesis.speak(utterance);
  };

  const prepareSpeechChunks = async (
    content: string,
    tab: SpeechTab
  ): Promise<string[]> => {
    const targetLang = speechLangRef.current;
    const cacheKey = buildSpeechCacheKey({
      meetingId: viewingMeetingIdRef.current,
      content,
      tab,
      targetLang,
    });
    const cached = getSpeechCache(cacheKey);
    if (cached?.chunks?.length) {
      return cached.chunks;
    }

    let textForSpeech = content;
    if (targetLang !== SPEECH_SOURCE_LANG) {
      const headers = await getApiHeaders(user, { "Content-Type": "application/json" });
      const res = await fetch("/api/speech/translate-text", {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: content,
          targetLang,
          sourceLang: SPEECH_SOURCE_LANG,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || "Speech translation failed");
      }
      textForSpeech = typeof data.text === "string" ? data.text : content;
    }

    const chunks = chunkTextForSpeech(textForSpeech);
    if (chunks.length) {
      setSpeechCache(cacheKey, { chunks });
    }
    return chunks;
  };

  const startReadAloud = async () => {
    if (!speechSupported) {
      showNotification("Read aloud is not supported in this browser.", "error");
      return;
    }
    if (isPreparingSpeech) return;

    const content = activeTab === "minutes" ? currentMinutes : currentTranscript;
    if (!content?.trim()) {
      showNotification("Nothing to read yet.", "info");
      return;
    }

    speechLangRef.current = getBrowserSpeechLang();
    setIsPreparingSpeech(true);
    try {
      const chunks = await prepareSpeechChunks(content, activeTab);
      if (!chunks.length) {
        showNotification("Could not prepare text for read aloud.", "error");
        return;
      }
      window.speechSynthesis.cancel();
      speechQueueRef.current = chunks;
      setIsReadingAloud(true);
      setIsReadAloudPaused(false);
      speakNextChunk();
      showNotification(
        `Reading ${activeTab === "minutes" ? "minutes" : "transcript"} aloud…`,
        "info"
      );
    } catch (err: any) {
      console.error("Read aloud preparation failed:", err);
      showNotification(`Read aloud failed: ${err?.message || err}`, "error");
    } finally {
      setIsPreparingSpeech(false);
    }
  };

  const toggleReadAloudPause = () => {
    if (!speechSupported || !isReadingAloud) return;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsReadAloudPaused(false);
    } else {
      window.speechSynthesis.pause();
      setIsReadAloudPaused(true);
    }
  };

  /** Old cached clients still calling retired Gemini 1.5 — force a hard reload.
   * Do NOT treat gemini-2.5 / 2.0 as stale — those are intentional fallbacks. */
  const notifyOrReloadIfStaleModel = (raw: unknown, fallbackPrefix: string) => {
    const message = typeof raw === "string" ? raw : (raw as any)?.message ? String((raw as any).message) : String(raw ?? "");
    if (/gemini-1\.5[\w.-]*/i.test(message)) {
      showNotification("App outdated — refreshing…", "error");
      setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("_refresh", String(Date.now()));
        window.location.replace(url.toString());
      }, 900);
      return;
    }
    showNotification(`${fallbackPrefix}: ${message}`, "error");
  };

  const getApiHeaders = async (
    currentUser?: FirebaseUser | { uid: string } | null,
    extra: Record<string, string> = {}
  ): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { ...extra };
    try {
      const auth = getAuth();
      const firebaseUser = (currentUser as FirebaseUser) || auth.currentUser;
      if (firebaseUser && "getIdToken" in firebaseUser) {
        headers["Authorization"] = `Bearer ${await firebaseUser.getIdToken()}`;
      }
    } catch (e) {
      console.warn("Failed to get Firebase ID token:", e);
    }
    return headers;
  };

  // App health / Config state
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [geminiModelLabel, setGeminiModelLabel] = useState(DISPLAY_GEMINI_MODEL);
  const [healthChecking, setHealthChecking] = useState(true);

  // Recorder states
  const [isRecording, setIsRecording] = useState(false);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [chunksUploaded, setChunksUploaded] = useState(0);
  const [isUploadingChunk, setIsUploadingChunk] = useState(false);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");

  // Results state
  const [activeTab, setActiveTab] = useState<"minutes" | "transcript">("minutes");
  const [currentMinutes, setCurrentMinutes] = useState<string | null>(null);
  const [currentTranscript, setCurrentTranscript] = useState<string | null>(null);

  // Input methods and fallback device states
  const [activeInputMethod, setActiveInputMethod] = useState<"stream" | "upload">("stream");
  const [dragActive, setDragActive] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  // History state
  const [history, setHistory] = useState<MeetingItem[]>([]);

  // Refs for recorder logic
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerIntervalRef = useRef<any>(null);
  const audioLevelRafRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rawMicStreamRef = useRef<MediaStream | null>(null);
  const chunksCountRef = useRef(0);
  const currentMeetingIdRef = useRef<string | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const selectedMimeRef = useRef<string>("audio/webm");
  const [micLevel, setMicLevel] = useState(0);

  const applyCreditsFromProfile = (data: any, currentUser: { email?: string | null }) => {
    const unlimited = !!data?.unlimited || isDeveloperEmail(currentUser.email);
    setUnlimitedCredits(unlimited);
    setMeetingCredits(
      unlimited ? UNLIMITED_CREDITS_SENTINEL : data?.meetingCredits || 0
    );
    if (data?.subscriptionStatus !== undefined) {
      setSubscriptionStatus(data.subscriptionStatus || "none");
    }
    return {
      unlimited,
      meetingCredits: unlimited
        ? UNLIMITED_CREDITS_SENTINEL
        : Number(data?.meetingCredits || 0),
    };
  };

  const formatMeetingsFromApi = (meetingsData: any[]): MeetingItem[] =>
    meetingsData.map((m: any) => ({
      meetingId: m.id,
      title: m.title,
      date: m.createdAt
        ? new Date(m.createdAt._seconds ? m.createdAt._seconds * 1000 : m.createdAt).toLocaleDateString() +
          " " +
          new Date(m.createdAt._seconds ? m.createdAt._seconds * 1000 : m.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Processed",
      duration:
        typeof m.duration === "number"
          ? formatTime(m.duration)
          : m.duration
          ? String(m.duration)
          : "—",
      transcript: m.transcript || m.summary || "",
      minutes: m.minutes || "",
      hasAudio: !!(m.hasAudio || m.audioStoragePath || m.audioLocalRelativePath),
      status: m.status || (m.minutes ? "processed" : "saved"),
      freeRedoEligible: !!m.freeRedoEligible,
      freeRedoUntil: m.freeRedoUntil || null,
    }));

  /** Profile only — used after checkout polling (no history fan-out). */
  const fetchProfileCredits = async (currentUser: any) => {
    if (!currentUser) return null;
    const url = `/api/user/profile?userId=${currentUser.uid}&email=${encodeURIComponent(currentUser.email || "")}&displayName=${encodeURIComponent(currentUser.displayName || "")}&photoURL=${encodeURIComponent(currentUser.photoURL || "")}`;
    const res = await fetch(url, { headers: await getApiHeaders(currentUser) });
    if (!res.ok) return null;
    const data = await res.json();
    return applyCreditsFromProfile(data, currentUser);
  };

  /**
   * After Stripe redirect: poll credits 2–3 times so webhook-granted balance appears
   * without a manual page refresh.
   */
  const pollCreditsAfterCheckout = async (currentUser: any) => {
    if (!currentUser) return;
    let baseline: number | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      try {
        const credits = await fetchProfileCredits(currentUser);
        if (!credits) continue;
        if (credits.unlimited) return;
        if (baseline === null) {
          baseline = credits.meetingCredits;
          continue;
        }
        if (credits.meetingCredits > baseline) return;
      } catch (err) {
        console.warn("Checkout credit poll failed:", err);
      }
    }
    // Final pass: refresh payments list so Billing tab stays accurate
    try {
      await fetchPaymentsHistory(currentUser.uid, currentUser);
    } catch {
      // ignore
    }
  };

  // Sync user profile + histories in parallel (login / rare full sync)
  const refreshUserProfile = async (currentUser: any) => {
    if (!currentUser) return;
    try {
      const authHeaders = await getApiHeaders(currentUser);
      const profileUrl = `/api/user/profile?userId=${currentUser.uid}&email=${encodeURIComponent(currentUser.email || "")}&displayName=${encodeURIComponent(currentUser.displayName || "")}&photoURL=${encodeURIComponent(currentUser.photoURL || "")}`;

      const [profileRes, paymentsRes, meetingsRes] = await Promise.all([
        fetch(profileUrl, { headers: authHeaders }),
        fetch(`/api/payments/history?userId=${currentUser.uid}`, { headers: authHeaders }),
        fetch(`/api/meetings/history?userId=${currentUser.uid}`, { headers: authHeaders }),
      ]);

      if (profileRes.ok) {
        const data = await profileRes.json();
        applyCreditsFromProfile(data, currentUser);
      }

      if (paymentsRes.ok) {
        const paymentsData = await paymentsRes.json();
        setPaymentsHistory(paymentsData);
      }

      if (meetingsRes.ok) {
        const meetingsData = await meetingsRes.json();
        const list = Array.isArray(meetingsData) ? meetingsData : [];
        const formattedMeetings = formatMeetingsFromApi(list);
        setHistory(formattedMeetings);
        writeCachedHistory(currentUser.uid, formattedMeetings);
      }
    } catch (e) {
      console.error("Error syncing user profile with server:", e);
    }
  };

  const fetchPaymentsHistory = async (
    userId: string,
    currentUser?: FirebaseUser | { uid: string } | null
  ) => {
    const authHeaders = await getApiHeaders(currentUser || { uid: userId });
    const paymentsRes = await fetch(`/api/payments/history?userId=${userId}`, {
      headers: authHeaders,
    });
    if (paymentsRes.ok) {
      const paymentsData = await paymentsRes.json();
      setPaymentsHistory(paymentsData);
    }
  };

  const fetchHistories = async (userId: string, currentUser?: FirebaseUser | { uid: string } | null) => {
    try {
      const authHeaders = await getApiHeaders(currentUser || { uid: userId });
      const [paymentsRes, meetingsRes] = await Promise.all([
        fetch(`/api/payments/history?userId=${userId}`, { headers: authHeaders }),
        fetch(`/api/meetings/history?userId=${userId}`, { headers: authHeaders }),
      ]);

      if (paymentsRes.ok) {
        const paymentsData = await paymentsRes.json();
        setPaymentsHistory(paymentsData);
      }

      if (meetingsRes.ok) {
        const meetingsData = await meetingsRes.json();
        const list = Array.isArray(meetingsData) ? meetingsData : [];
        const formattedMeetings = formatMeetingsFromApi(list);
        setHistory(formattedMeetings);
        writeCachedHistory(userId, formattedMeetings);
      }
    } catch (err) {
      console.error("Failed to fetch user histories:", err);
    }
  };

  // Fetch Firebase Config and Health Check on mount
  useEffect(() => {
    applyTheme(themePreference);
  }, [themePreference]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readThemePreference() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    async function initApp() {
      try {
        // Fetch server health
        const healthRes = await fetch("/api/health");
        if (healthRes.ok) {
          const healthData = await healthRes.json();
          setServerReachable(true);
          setGeminiConfigured(!!healthData.geminiConfigured);
          // Display is hardcoded — never show a stale 1.5 label from old health payloads.
          setGeminiModelLabel(formatGeminiModelLabel(healthData.processingModel || healthData.geminiModel));
        } else {
          setServerReachable(false);
        }
      } catch (err) {
        console.error("Server health check failed:", err);
        setServerReachable(false);
      } finally {
        setHealthChecking(false);
      }

      try {
        // Fetch Firebase Applet config served statically
        const configRes = await fetch("/firebase-applet-config.json");
        if (configRes.ok) {
          const config = await configRes.json();
          setFirebaseConfig(config);
          
          // Initialize Firebase client
          const app = initializeApp(config);
          const auth = getAuth(app);

          onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
              setUser(firebaseUser);
              if (isDeveloperEmail(firebaseUser.email)) {
                setUnlimitedCredits(true);
                setMeetingCredits(UNLIMITED_CREDITS_SENTINEL);
              }
              // Optimistic per-user cache, then replace from server (cross-device source of truth)
              const cached = readCachedHistory(firebaseUser.uid);
              if (cached) setHistory(cached);
              else setHistory([]);
              await refreshUserProfile(firebaseUser);

              const params = new URLSearchParams(window.location.search);
              if (params.get("checkout_success") === "true") {
                const credits = params.get("credits");
                if (credits) {
                  showNotification(`🎉 Payment successful! ${credits} meeting credit(s) have been added to your account.`, "success");
                } else {
                  showNotification(`🎉 Payment successful! Your credits have been updated.`, "success");
                }
                window.history.replaceState({}, document.title, window.location.pathname);
                // Webhook may lag behind redirect — poll credits without full page reload
                void pollCreditsAfterCheckout(firebaseUser);
              }
            } else {
              setUser(null);
              setMeetingCredits(0);
              setUnlimitedCredits(false);
              setHistory([]);
              setPaymentsHistory([]);
            }
            setAuthInitialized(true);
          });
        } else {
          console.error("Failed to load firebase-applet-config.json");
          setAuthInitialized(true);
        }
      } catch (err) {
        console.error("Error initializing Firebase:", err);
        setAuthInitialized(true);
      }

      // Check Stripe Configuration Status
      try {
        const stripeRes = await fetch("/api/stripe/config");
        if (stripeRes.ok) {
          const stripeData = await stripeRes.json();
          setStripeConfigured(stripeData.configured);
        }
      } catch (stripeErr) {
        console.error("Failed to check Stripe config:", stripeErr);
      }

      // Check for Checkout cancellation redirect (success handled after auth)
      const params = new URLSearchParams(window.location.search);
      if (params.get("checkout_cancelled") === "true") {
        showNotification("Purchase checkout was cancelled. Let us know if we can help you with anything!", "info");
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }

    void initApp();

    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Re-sync credits + history when returning to the app on another device / tab
  const userRef = useRef<FirebaseUser | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let lastSyncAt = 0;
    const SYNC_COOLDOWN_MS = 8_000;

    const syncFromServer = () => {
      const current = userRef.current;
      if (!current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastSyncAt < SYNC_COOLDOWN_MS) return;
      lastSyncAt = now;
      void refreshUserProfile(current);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") syncFromServer();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", syncFromServer);
    // Periodic soft sync while the signed-in tab stays open
    const intervalId = window.setInterval(syncFromServer, 60_000);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", syncFromServer);
      window.clearInterval(intervalId);
    };
  }, [user?.uid]);

  // Stop readout if minutes are cleared
  useEffect(() => {
    if (!currentMinutes && isReadingAloud) {
      stopReadAloud();
    }
  }, [currentMinutes, isReadingAloud]);

  // Format seconds into HH:MM:SS
  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [
      hours.toString().padStart(2, "0"),
      minutes.toString().padStart(2, "0"),
      seconds.toString().padStart(2, "0")
    ].join(":");
  };

  // Stripe one-time checkout for credit packages (1, 5, or 10 credits)
  const handleCreditCheckout = async (credits: number) => {
    if (!user) {
      showNotification("Please sign in with Google to purchase credits.", "error");
      return;
    }
    const packageId = creditsToPackageId(credits);
    if (!packageId) {
      showNotification("Invalid package. Choose 1, 5, or 10 credits.", "error");
      return;
    }
    setCheckingOutPlan(credits);
    try {
      const res = await fetch("/api/stripe/checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await getApiHeaders(user)),
        },
        body: JSON.stringify({ packageId, credits, userId: user.uid, email: user.email || undefined }),
      });

      if (!res.ok) {
        const errText = await res.text();
        let message = errText || "Checkout failed";
        try {
          const parsed = JSON.parse(errText);
          message = parsed.error || parsed.message || message;
        } catch {
          // keep raw text fallback
        }
        throw new Error(message);
      }

      const data = await res.json();
      if (data.url) {
        if (data.simulated) {
          setPurchaseQuantity(credits);
          setShowSimulatedCheckout(true);
        } else {
          window.location.href = data.url;
        }
      }
    } catch (err: any) {
      console.error("Checkout session creation failed:", err);
      showNotification(`Purchase checkout error: ${err.message}`, "error");
    } finally {
      setCheckingOutPlan(null);
    }
  };

  // Simulated Payment processing
  const handleAuthorizeSimulatedPayment = async (quantity: number) => {
    if (!user) return;
    setIsProcessingSimulatedPayment(true);
    try {
      const res = await fetch("/api/stripe/simulated-success", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await getApiHeaders(user)),
        },
        body: JSON.stringify({ userId: user.uid, quantity }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || "Simulation success registration failed.");
      }

      const data = await res.json();
      setShowSimulatedCheckout(false);
      setActiveDashboardTab("dashboard");
      
      // Refresh user profile
      await refreshUserProfile(user);
      
      showNotification(`🎉 Simulated Sandbox Payment Authorized! Your account has been credited with ${data.creditsPurchased} meeting credits. Thank you!`, "success");
    } catch (err: any) {
      console.error("Simulated payment failed:", err);
      showNotification(`Simulation authorization error: ${err.message}`, "error");
    } finally {
      setIsProcessingSimulatedPayment(false);
    }
  };

  // Delete User Account
  const handleDeleteAccount = async () => {
    if (!user) return;
    if (!window.confirm("Are you absolutely sure you want to delete your MinutesFlow AI account? This action is permanent, non-refundable, and will instantly purge your entire meeting history, payment history, and credits from our database.")) {
      return;
    }
    
    setIsDeletingAccount(true);
    try {
      const res = await fetch("/api/user/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await getApiHeaders(user)),
        },
        body: JSON.stringify({ userId: user.uid }),
      });
      if (res.ok) {
        showNotification("Your MinutesFlow AI account has been successfully deleted.", "info");
        const auth = getAuth();
        await signOut(auth);
      setUser(null);
      setMeetingCredits(0);
      setUnlimitedCredits(false);
      setHistory([]);
      clearCachedHistory(user?.uid);
      clearSpeechCache();
      } else {
        const errorText = await res.text();
        throw new Error(errorText || "Deletion failed");
      }
    } catch (err: any) {
      console.error("Account deletion failed:", err);
      showNotification(`Account Deletion Error: ${err.message}`, "error");
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleSignIn = async () => {
    if (!firebaseConfig) return;
    setAuthLoading(true);
    setAuthErrorMessage(null);
    try {
      const auth = getAuth();
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error("Google Sign-In failed:", err);
      const msg = err.message || String(err);
      setAuthErrorMessage(msg);
      setShowTroubleshootModal(true);
      if (err.code === "auth/popup-closed-by-user" || msg.includes("popup-closed-by-user")) {
        showNotification(
          "🔒 Google Sign-In popup was closed or blocked. Click the 'Sign-In Help' or run the app in a 'New Tab'!", 
          "error"
        );
      } else {
        showNotification(`Google Sign-In failed: ${msg}`, "error");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout
  const handleSignOut = async () => {
    try {
      const auth = getAuth();
      await signOut(auth);
      setUser(null);
      setMeetingCredits(0);
      setUnlimitedCredits(false);
      setHistory([]);
      clearCachedHistory(user?.uid);
      clearSpeechCache();
      showNotification("Signed out successfully.", "success");
    } catch (err) {
      console.error("Sign out failed:", err);
    }
  };

  // Start continuous chunked recording (save is free; generate minutes needs a credit)
  const startRecording = async () => {
    if (!user) return;
    try {
      // Clear previous outputs
      setCurrentMinutes(null);
      setCurrentTranscript(null);
      setDeviceError(null);
      setPendingRecording(null);

      // Prefer a sensitive mic path: AGC on, lighter noise suppression so quiet speech survives.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
        } as MediaTrackConstraints,
      });
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length || audioTracks.every((t) => t.readyState !== "live" || t.muted)) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("No live microphone audio track available");
      }
      rawMicStreamRef.current = stream;
      console.log(
        "Mic tracks:",
        audioTracks.map((t) => `${t.label || "unnamed"} ready=${t.readyState} muted=${t.muted} enabled=${t.enabled}`)
      );

      // Boost gain into the recorded stream + live meter (quiet mics / distant speech).
      let recordStream: MediaStream = stream;
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx: AudioContext = new Ctx();
        audioContextRef.current = ctx;
        if (ctx.state === "suspended") await ctx.resume();

        const source = ctx.createMediaStreamSource(stream);
        const gainNode = ctx.createGain();
        gainNode.gain.value = MIC_GAIN_BOOST;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.35;
        const destination = ctx.createMediaStreamDestination();

        source.connect(gainNode);
        gainNode.connect(analyser);
        gainNode.connect(destination);
        recordStream = destination.stream;

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          // Amplify meter display so quiet speech still reads as “Voice detected”
          setMicLevel(Math.min(1, rms * 9));
          audioLevelRafRef.current = requestAnimationFrame(tick);
        };
        audioLevelRafRef.current = requestAnimationFrame(tick);
      } catch (meterErr) {
        console.warn("Mic gain/meter unavailable; using raw mic stream:", meterErr);
        setMicLevel(0);
      }

      // Generate a brand new meeting ID
      const newMeetingId = `mtg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      setMeetingId(newMeetingId);
      currentMeetingIdRef.current = newMeetingId;

      setRecordingSeconds(0);
      setChunksUploaded(0);
      chunksCountRef.current = 0;
      recordedChunksRef.current = [];
      setPendingRecording(null);

      // Select most compatible audio MIME type
      const mimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
        "audio/aac",
        "audio/wav"
      ];
      let selectedMime = "audio/webm";
      for (const mime of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mime)) {
          selectedMime = mime;
          break;
        }
      }

      selectedMimeRef.current = selectedMime;
      console.log(`Starting MediaRecorder with mimeType: ${selectedMime}, gain=${MIC_GAIN_BOOST}x`);

      // Timeslice of 5 seconds to collect chunks in memory
      const options = { mimeType: selectedMime };
      const mediaRecorder = new MediaRecorder(recordStream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          setChunksUploaded((prev) => prev + 1);
        }
      };

      // Start recording with 5-second chunk intervals
      mediaRecorder.start(5000);
      setIsRecording(true);

      // Start Timer
      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Microphone access or recorder start error:", err);
      setDeviceError("Microphone device not found or browser permission denied. This is common if your system has no active microphone connected, or if browser sandbox permissions are restricted. No worries! You can use the high-performance 'Upload Audio File' panel above to process any pre-recorded audio file.");
      setActiveInputMethod("upload");
    }
  };

  // Stop recording — keep audio ready to Save or Generate minutes
  const stopRecording = async () => {
    if (!isRecording || !mediaRecorderRef.current || !user) return;

    setIsRecording(false);
    clearInterval(timerIntervalRef.current);
    if (audioLevelRafRef.current != null) {
      cancelAnimationFrame(audioLevelRafRef.current);
      audioLevelRafRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setMicLevel(0);

    const finalSeconds = recordingSeconds;
    const finalDuration = formatTime(finalSeconds);
    const recorder = mediaRecorderRef.current;
    const stream = recorder.stream;

    // Wait for the final dataavailable flush that fires after stop().
    const stopPromise = new Promise<void>((resolve) => {
      const finish = () => resolve();
      recorder.addEventListener("stop", finish, { once: true });
      // Safety timeout so a hung recorder cannot block forever
      setTimeout(finish, 3000);
    });

    try {
      // Force a final chunk before stop — some browsers drop the last timeslice otherwise.
      if (recorder.state === "recording") {
        try {
          recorder.requestData();
        } catch {
          /* requestData not supported / ignored */
        }
        recorder.stop();
      }
    } catch (stopErr) {
      console.error("MediaRecorder.stop failed:", stopErr);
    }

    await stopPromise;

    // Only tear down mic tracks AFTER the recorder has flushed its final blob.
    stream.getTracks().forEach((track) => track.stop());
    rawMicStreamRef.current?.getTracks().forEach((track) => track.stop());
    rawMicStreamRef.current = null;

    const finalBlob = new Blob(recordedChunksRef.current, { type: selectedMimeRef.current });
    console.log(
      `Recording stopped: ${finalSeconds}s, ${recordedChunksRef.current.length} chunks, blob=${finalBlob.size} bytes, mime=${selectedMimeRef.current}`
    );

    // Fail before upload/charge when capture is empty or too short
    if (finalSeconds < MIN_RECORDING_SECONDS || finalBlob.size < MIN_AUDIO_BYTES) {
      setMeetingId(null);
      currentMeetingIdRef.current = null;
      setRecordingSeconds(0);
      setChunksUploaded(0);
      recordedChunksRef.current = [];
      setPendingRecording(null);
      showNotification(
        "Recording too short / no audio captured. Hold for at least a few seconds, speak clearly into your mic, then stop.",
        "error"
      );
      return;
    }

    const titleToUse = meetingTitle.trim() || `Meeting on ${new Date().toLocaleDateString()}`;
    setPendingRecording({
      blob: finalBlob,
      mimeType: selectedMimeRef.current,
      durationSeconds: finalSeconds,
      durationLabel: finalDuration,
      title: titleToUse,
    });
    setMeetingId(null);
    currentMeetingIdRef.current = null;
    setChunksUploaded(0);
    recordedChunksRef.current = [];
    showNotification("Recording ready — Save to history, or Generate minutes now.", "info");
  };

  const discardPendingRecording = () => {
    setPendingRecording(null);
    setRecordingSeconds(0);
    showNotification("Recording discarded.", "info");
  };

  /** Save recording to history only (no Gemini / no credit). Redo later. */
  const savePendingRecording = async () => {
    if (!user || !pendingRecording) return;
    if (isSavingRecording || isProcessing) return;

    setIsSavingRecording(true);
    try {
      const clientDateTime = new Date().toLocaleString("en-US", {
        dateStyle: "full",
        timeStyle: "short",
      });
      const response = await fetch(
        `/api/recording/save?title=${encodeURIComponent(pendingRecording.title)}&mimeType=${encodeURIComponent(pendingRecording.mimeType)}&clientDateTime=${encodeURIComponent(clientDateTime)}&duration=${pendingRecording.durationSeconds}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-user-id": user.uid,
            ...(await getApiHeaders(user)),
          },
          body: pendingRecording.blob,
        }
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || data.error || "Failed to save recording.");
      }

      const newHistoryItem: MeetingItem = {
        meetingId: data.meeting?.id || `saved_${Date.now()}`,
        title: pendingRecording.title,
        date:
          new Date().toLocaleDateString() +
          " " +
          new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        duration: pendingRecording.durationLabel,
        transcript: "",
        minutes: "",
        hasAudio: true,
        status: "saved",
      };
      const updatedHistory = [newHistoryItem, ...history];
      setHistory(updatedHistory);
      writeCachedHistory(user.uid, updatedHistory);
      setPendingRecording(null);
      setRecordingSeconds(0);
      showNotification("Recording saved to history. Generate minutes anytime from History.", "success");
      setActiveDashboardTab("history");
    } catch (error: any) {
      console.error("Save recording failed:", error);
      showNotification(`Save failed: ${error?.message || error}`, "error");
    } finally {
      setIsSavingRecording(false);
    }
  };

  /** Generate minutes from the staged recording (1 credit). */
  const generateFromPendingRecording = async () => {
    if (!user || !pendingRecording) return;
    if (!hasCredits) {
      showNotification(`You need at least 1 meeting credit (RM${CREDIT_PRICE_RM}) to generate minutes.`, "error");
      setActiveDashboardTab("credits");
      return;
    }

    const staged = pendingRecording;
    setPendingRecording(null);
    setIsProcessing(true);
    setProcessingStatus("Assembling audio and uploading securely...");

    try {
      setProcessingStatus(`Translating, transcribing and structuring meeting minutes with ${geminiModelLabel}...`);

      const clientDateTime = new Date().toLocaleString("en-US", {
        dateStyle: "full",
        timeStyle: "short",
      });

      const response = await fetch(
        `/api/recording/upload?title=${encodeURIComponent(staged.title)}&mimeType=${encodeURIComponent(staged.mimeType)}&clientDateTime=${encodeURIComponent(clientDateTime)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-user-id": user.uid,
            ...(await getApiHeaders(user)),
          },
          body: staged.blob,
        }
      );

      if (!response.ok) {
        let errorMessage = "Failed to process meeting audio.";
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errorData = await response.json();
            if (errorData.error === "INSUFFICIENT_CREDITS") {
              setActiveDashboardTab("credits");
              errorMessage = errorData.message || "No meeting credits remaining. Purchase credits to continue.";
            } else if (errorData.error === "EMPTY_AUDIO" || errorData.error === "AUDIO_TOO_SHORT") {
              errorMessage =
                errorData.message ||
                "Recording too short / no audio captured. Check your microphone and try again.";
            } else {
              errorMessage = errorData.error || errorData.message || errorMessage;
            }
          } else {
            const text = await response.text();
            console.warn("Non-JSON error response from server:", text.substring(0, 200));
            errorMessage = `Server Error (${response.status}): ${response.statusText || "Internal Server Error"}`;
          }
        } catch (parseErr) {
          console.error("Error parsing response error data:", parseErr);
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setCurrentMinutes(data.minutes);
      setCurrentTranscript(data.transcript);
      viewingMeetingIdRef.current = data.meeting?.id || null;
      setActiveTab("minutes");

      if (data.meetingCreditsRemaining !== undefined) {
        setMeetingCredits(
          unlimitedCredits || data.unlimited
            ? UNLIMITED_CREDITS_SENTINEL
            : data.meetingCreditsRemaining
        );
        if (data.unlimited) setUnlimitedCredits(true);
      }

      if (data.noSpeechDetected || isNoSpeechContent(data.transcript, data.minutes)) {
        showNotification(
          data.creditCharged === false
            ? "No speech detected in the recording. Your credit was not charged. Check your mic and try again."
            : "No speech detected in the recording. Check your microphone and try again.",
          "info"
        );
      }

      const newHistoryItem: MeetingItem = {
        meetingId: data.meeting?.id || `upload_${Date.now()}`,
        title: staged.title,
        date:
          new Date().toLocaleDateString() +
          " " +
          new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        duration: staged.durationLabel,
        transcript: data.transcript,
        minutes: data.minutes,
        hasAudio: !!(data.meeting?.hasAudio || data.meeting?.audioStoragePath || data.meeting?.audioLocalRelativePath),
        status: data.noSpeechDetected ? "no_speech" : "processed",
        freeRedoEligible: !!data.freeRedoUntil,
        freeRedoUntil: data.freeRedoUntil || null,
      };

      const updatedHistory = [newHistoryItem, ...history];
      setHistory(updatedHistory);
      writeCachedHistory(user.uid, updatedHistory);
      setRecordingSeconds(0);
    } catch (error: any) {
      console.error("Meeting minutes processing failed:", error);
      const msg = String(error?.message || error);
      notifyOrReloadIfStaleModel(
        /fetch failed|Failed to fetch|network|Timeout|UND_ERR|gemini-3\.5/i.test(msg)
          ? "Could not reach the AI service (temporary network issue). Please try again in a few seconds."
          : error?.message ?? error,
        "Processing Failed"
      );
      setPendingRecording(staged);
    } finally {
      setIsProcessing(false);
      setMeetingId(null);
      currentMeetingIdRef.current = null;
      setChunksUploaded(0);
    }
  };

  // Load a historic meeting item to view details
  const viewHistoryItem = (item: MeetingItem) => {
    viewingMeetingIdRef.current = item.meetingId;
    setMeetingTitle(item.title);
    setCurrentMinutes(item.minutes || null);
    setCurrentTranscript(item.transcript || null);
    setActiveTab("minutes");
    if (!item.minutes && item.hasAudio) {
      showNotification("Recording saved — use Generate in History to create minutes (1 credit).", "info");
    }
    // Scroll window smoothly to results panel
    const element = document.getElementById("results-panel");
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Delete meeting from history (server + local)
  const deleteHistoryItem = async (idToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleteConfirmId !== idToDelete) {
      setDeleteConfirmId(idToDelete);
      // Auto reset after 3 seconds
      setTimeout(() => {
        setDeleteConfirmId((prev) => prev === idToDelete ? null : prev);
      }, 3000);
      return;
    }
    setDeleteConfirmId(null);

    if (user) {
      try {
        const headers = await getApiHeaders(user, { "x-user-id": user.uid });
        const res = await fetch(`/api/meetings/${encodeURIComponent(idToDelete)}?userId=${encodeURIComponent(user.uid)}`, {
          method: "DELETE",
          headers,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Server delete failed");
        }
      } catch (err: any) {
        console.warn("Server meeting delete:", err?.message || err);
        showNotification(`Cloud delete warning: ${err?.message || err}. Removed from this device.`, "info");
      }
    }

    const updated = history.filter((item) => item.meetingId !== idToDelete);
    setHistory(updated);
    writeCachedHistory(user.uid, updated);
    invalidateSpeechCacheForMeeting(idToDelete);
    setSelectedHistoryIds((prev) => {
      const next = new Set(prev);
      next.delete(idToDelete);
      return next;
    });

    // Reset current active states if viewing deleted item
    if (meetingId === idToDelete || (currentMinutes && history.find(h => h.meetingId === idToDelete)?.minutes === currentMinutes)) {
      setCurrentMinutes(null);
      setCurrentTranscript(null);
    }
    showNotification("Meeting deleted.", "info");
  };

  const toggleHistorySelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedHistoryIds.size === history.length) {
      setSelectedHistoryIds(new Set());
    } else {
      setSelectedHistoryIds(new Set(history.map((h) => h.meetingId)));
    }
  };

  const applyLocalHistoryPurge = (idsToRemove: Set<string> | "all") => {
    const clearAll = idsToRemove === "all";
    if (clearAll) {
      clearSpeechCache();
    } else {
      for (const id of idsToRemove) {
        invalidateSpeechCacheForMeeting(id);
      }
    }
    const updated = clearAll
      ? []
      : history.filter((item) => !idsToRemove.has(item.meetingId));
    setHistory(updated);
    writeCachedHistory(user.uid, updated);
    setSelectedHistoryIds(new Set());
    setDeleteConfirmId(null);

    const removedIds = clearAll
      ? new Set(history.map((h) => h.meetingId))
      : idsToRemove;
    const viewingDeleted =
      (meetingId ? removedIds.has(meetingId) : false) ||
      (currentMinutes
        ? history.some((h) => removedIds.has(h.meetingId) && h.minutes === currentMinutes)
        : false);
    if (viewingDeleted) {
      setCurrentMinutes(null);
      setCurrentTranscript(null);
    }
  };

  const bulkDeleteHistory = async (mode: "selected" | "all") => {
    if (isBulkDeleting || history.length === 0) return;

    if (mode === "selected" && selectedHistoryIds.size === 0) {
      showNotification("Select at least one meeting to delete.", "info");
      return;
    }

    const count = mode === "all" ? history.length : selectedHistoryIds.size;
    const label = mode === "all" ? "clear ALL meeting history" : `delete ${count} selected meeting${count === 1 ? "" : "s"}`;
    if (!window.confirm(`Are you sure you want to ${label}? This cannot be undone.`)) {
      return;
    }

    setIsBulkDeleting(true);
    try {
      if (user) {
        const headers = await getApiHeaders(user, {
          "Content-Type": "application/json",
          "x-user-id": user.uid,
        });
        const res = await fetch(`/api/meetings/bulk-delete?userId=${encodeURIComponent(user.uid)}`, {
          method: "POST",
          headers,
          body: JSON.stringify(
            mode === "all"
              ? { clearAll: true }
              : { meetingIds: Array.from(selectedHistoryIds) }
          ),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Bulk delete failed");
        }
      }

      applyLocalHistoryPurge(mode === "all" ? "all" : new Set(selectedHistoryIds));
      showNotification(
        mode === "all"
          ? "All meeting history cleared."
          : `Deleted ${count} meeting${count === 1 ? "" : "s"}.`,
        "success"
      );
    } catch (err: any) {
      showNotification(`Delete failed: ${err?.message || err}`, "error");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const downloadMeetingAudio = async (item: MeetingItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user || !item.hasAudio) return;
    try {
      const headers = await getApiHeaders(user, { "x-user-id": user.uid });
      const res = await fetch(
        `/api/meetings/${encodeURIComponent(item.meetingId)}/audio-url?userId=${encodeURIComponent(user.uid)}`,
        { headers }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Download unavailable");

      if (data.local && data.url) {
        const fileRes = await fetch(data.url, { headers });
        if (!fileRes.ok) throw new Error("Could not fetch local recording");
        const blob = await fileRes.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `${(item.title || "recording").replace(/[^\w.-]+/g, "_").slice(0, 80)}.webm`;
        a.click();
        URL.revokeObjectURL(objectUrl);
      } else if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        throw new Error("No download URL returned");
      }
      showNotification("Download started.", "success");
    } catch (err: any) {
      showNotification(`Download failed: ${err?.message || err}`, "error");
    }
  };

  // Redo meeting minutes from a saved recording (uses 1 credit)
  const redoMeetingMinutes = async (item: MeetingItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;

    if (!item.hasAudio) {
      showNotification(
        "No saved recording for this meeting. Only newer meetings can be redone.",
        "error"
      );
      return;
    }

    if (!hasCredits && !item.freeRedoEligible) {
      showNotification(`You need at least 1 meeting credit (RM${CREDIT_PRICE_RM}) to generate/redo minutes.`, "error");
      setActiveDashboardTab("credits");
      return;
    }

    if (redoingMeetingId || isProcessing) return;

    setRedoingMeetingId(item.meetingId);
    setIsProcessing(true);
    const progressTips = [
      `Working with ${geminiModelLabel}…`,
      "Still working — longer meetings can take several minutes…",
      "Translating and structuring minutes…",
      "Almost there — finalizing transcript…",
    ];
    let tipIdx = 0;
    setProcessingStatus(progressTips[0]);
    const tipTimer = setInterval(() => {
      tipIdx = (tipIdx + 1) % progressTips.length;
      setProcessingStatus(progressTips[tipIdx]);
    }, 12000);
    setActiveDashboardTab("record");
    setMeetingTitle(item.title);

    try {
      const clientDateTime = new Date().toLocaleString("en-US", {
        dateStyle: "full",
        timeStyle: "short",
      });
      const headers = await getApiHeaders(user, {
        "Content-Type": "application/json",
        "x-user-id": user.uid,
      });

      const res = await fetch("/api/meetings/reprocess", {
        method: "POST",
        headers,
        body: JSON.stringify({
          meetingId: item.meetingId,
          userId: user.uid,
          clientDateTime,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "INSUFFICIENT_CREDITS") {
          setActiveDashboardTab("credits");
        }
        throw new Error(data.message || data.error || "Failed to redo meeting minutes.");
      }

      setCurrentTranscript(data.transcript || "");
      setCurrentMinutes(data.minutes || "");
      invalidateSpeechCacheForMeeting(item.meetingId);
      setActiveTab("minutes");

      if (data.meetingCreditsRemaining !== undefined) {
        setMeetingCredits(
          unlimitedCredits || data.unlimited
            ? UNLIMITED_CREDITS_SENTINEL
            : data.meetingCreditsRemaining
        );
        if (data.unlimited) setUnlimitedCredits(true);
      }

      const updatedItem: MeetingItem = {
        ...item,
        transcript: typeof data.transcript === "string" ? data.transcript : item.transcript,
        minutes: typeof data.minutes === "string" ? data.minutes : item.minutes,
        hasAudio: true,
        status: data.noSpeechDetected ? "no_speech" : "processed",
        freeRedoEligible: !!data.freeRedoUntil,
        freeRedoUntil: data.freeRedoUntil || null,
        date:
          new Date().toLocaleDateString() +
          " " +
          new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      const updatedHistory = history.map((h) =>
        h.meetingId === item.meetingId ? updatedItem : h
      );
      setHistory(updatedHistory);
      writeCachedHistory(user.uid, updatedHistory);

      if (data.noSpeechDetected || isNoSpeechContent(data.transcript, data.minutes)) {
        showNotification(
          data.creditCharged === false
            ? "Done: no speech detected. Your credit was not charged."
            : "Done: no speech detected in the saved recording.",
          "info"
        );
      } else if (data.freeRedo || data.creditCharged === false) {
        showNotification(
          item.minutes
            ? "Minutes regenerated (free redo within 24h)."
            : "Minutes generated. Free redo available for 24 hours.",
          "success"
        );
      } else {
        showNotification(
          item.minutes
            ? "Meeting minutes regenerated from saved recording."
            : "Meeting minutes generated from saved recording. Free redo for 24h.",
          "success"
        );
      }
    } catch (error: any) {
      console.error("Redo meeting minutes failed:", error);
      notifyOrReloadIfStaleModel(
        /fetch failed|Failed to fetch|network|Timeout/i.test(String(error?.message || error))
          ? "Could not reach the AI service (temporary network issue). Please try Redo again in a few seconds."
          : error?.message ?? error,
        "Redo failed"
      );
    } finally {
      clearInterval(tipTimer);
      setRedoingMeetingId(null);
      setIsProcessing(false);
    }
  };

  // Stage uploaded audio for Save or Generate (same flow as live capture)
  const handleAudioUpload = async (file: File) => {
    if (!user) return;
    if (!file) return;

    if (file.size < MIN_AUDIO_BYTES) {
      showNotification(
        "Recording too short / no audio captured. Choose a longer audio file with clear speech.",
        "error"
      );
      return;
    }

    const sizeInMb = file.size / (1024 * 1024);
    if (sizeInMb > 500) {
      showNotification(`⚠️ File size of ${sizeInMb.toFixed(1)}MB exceeds the 500MB maximum file limit!`, "error");
      return;
    }

    setCurrentMinutes(null);
    setCurrentTranscript(null);
    setDeviceError(null);

    const titleToUse =
      meetingTitle.trim() || file.name.replace(/\.[^/.]+$/, "") || `Meeting on ${new Date().toLocaleDateString()}`;

    setPendingRecording({
      blob: file,
      mimeType: file.type || "audio/webm",
      durationSeconds: 0,
      durationLabel: "File Upload",
      title: titleToUse,
    });
    setActiveInputMethod("stream");
    setMeetingTitle(titleToUse);
    showNotification("File ready — Save to history for free, or Generate minutes (1 credit).", "info");
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleAudioUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleAudioUpload(e.target.files[0]);
    }
  };

  // Extract User Initials
  const getUserInitials = () => {
    if (!user || !user.displayName) return "U";
    return user.displayName
      .split(" ")
      .map((name) => name[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
  };

  const minutesGenerated = history.filter((h) => h.minutes).length;

  return (
    <div className="min-h-screen bg-[var(--color-mf-bg)] text-[var(--color-mf-ink)] font-sans antialiased">
      <style>{`
        @keyframes saasWave {
          0% { transform: scaleY(0.3); }
          50% { transform: scaleY(1.1); }
          100% { transform: scaleY(0.3); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .saas-wave-bar {
          animation: saasWave 1.2s ease-in-out infinite;
          transform-origin: center;
        }
      `}</style>

      <Toast
        notification={notification}
        onDismiss={() => setNotification(null)}
        hasBottomNav={!!user}
      />
      <InstallAppPrompt
        suppress={!!user && activeDashboardTab !== "dashboard"}
        hasBottomNav={!!user}
      />

      {!user ? (
        <div className="min-h-screen min-h-[100dvh] flex flex-col safe-area-x bg-[var(--color-mf-bg)]">
          <header className="min-h-14 sm:min-h-16 border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between bg-white/90 backdrop-blur-md safe-area-pt">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center">
                <Mic className="w-5 h-5 text-white" />
              </div>
              <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900">
                MinutesFlow <span className="text-blue-600">AI</span>
              </span>
            </div>
            {authInitialized && (
              <button
                onClick={handleSignIn}
                disabled={authLoading}
                className="mf-btn mf-btn-primary"
              >
                {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                Sign In
              </button>
            )}
          </header>

          <div className="flex-1">
          <main className="max-w-4xl w-full mx-auto px-4 sm:px-6 pt-6 sm:pt-14 pb-8 sm:pb-8">
            <div className="sm:bg-white sm:border sm:border-slate-200 sm:rounded-2xl p-4 sm:p-10 lg:p-12 text-center relative overflow-hidden sm:shadow-sm">
            <div className="absolute inset-0 hidden sm:flex items-center justify-center opacity-[0.03] pointer-events-none motion-safe:opacity-[0.03]" aria-hidden>
              <div className="flex gap-2 items-center">
                <div className="w-1.5 h-16 bg-blue-600 rounded-full"></div>
                <div className="w-1.5 h-32 bg-blue-600 rounded-full"></div>
                <div className="w-1.5 h-24 bg-blue-600 rounded-full"></div>
                <div className="w-1.5 h-40 bg-blue-600 rounded-full"></div>
                <div className="w-1.5 h-28 bg-blue-600 rounded-full"></div>
              </div>
            </div>

            <div className="relative z-10 space-y-5 sm:space-y-6">
              <div className="w-14 h-14 sm:w-16 sm:h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto border border-blue-100">
                <Sparkles className="w-7 h-7 sm:w-8 sm:h-8" />
              </div>
              <h1 className="text-2xl sm:text-4xl font-semibold text-slate-900 tracking-tight text-balance">
                Speak any language. Understand every one.
              </h1>
              <p className="text-slate-500 text-sm sm:text-base leading-relaxed max-w-xl mx-auto">
                Record in any mix of languages — get structured English minutes with summary, decisions, and action items.
              </p>

              <div className="pt-1 sm:pt-2 max-w-sm mx-auto w-full">
                <button
                  onClick={handleSignIn}
                  disabled={authLoading}
                  className="w-full mf-btn mf-btn-primary min-h-12 py-3.5"
                >
                  {authLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Globe className="w-5 h-5" />
                  )}
                  Sign in with Google
                </button>
                <p className="text-xs text-slate-500 mt-4 text-center leading-relaxed">
                  By signing in, you agree to our{" "}
                  <button
                    type="button"
                    onClick={() => setLegalDocType("privacy")}
                    className="text-slate-600 hover:text-blue-600 underline underline-offset-2 cursor-pointer transition-colors"
                  >
                    Privacy Policy
                  </button>{" "}
                  and{" "}
                  <button
                    type="button"
                    onClick={() => setLegalDocType("terms")}
                    className="text-slate-600 hover:text-blue-600 underline underline-offset-2 cursor-pointer transition-colors"
                  >
                    Terms of Service
                  </button>
                  .
                </p>

                <button
                  type="button"
                  onClick={() => setShowTroubleshootModal(true)}
                  className="mt-5 text-xs text-blue-600 hover:text-blue-700 underline cursor-pointer block mx-auto min-h-11 inline-flex items-center"
                >
                  Having Google Sign-In issues? Get Help
                </button>
              </div>
            </div>
            </div>
          </main>

          <LandingPricing
            onGetStarted={handleSignIn}
            creditPriceRm={CREDIT_PRICE_RM}
            loading={authLoading}
          />
          </div>

          <footer className="border-t border-slate-200 bg-white px-6 py-4 text-center space-y-2">
            <ManualLink onOpen={() => setShowOperationManual(true)} className="mx-auto" />
            <LegalLinks onOpen={setLegalDocType} />
            <AiDisclaimer className="max-w-xl mx-auto" />
          </footer>
        </div>
      ) : (
        <DashboardLayout
          activeTab={activeDashboardTab}
          onTabChange={setActiveDashboardTab}
          user={user}
          meetingCredits={meetingCredits}
          unlimitedCredits={unlimitedCredits}
          onSignOut={handleSignOut}
          getUserInitials={getUserInitials}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          onOpenLegal={setLegalDocType}
          onOpenManual={() => setShowOperationManual(true)}
        >
          <div className="app-content space-y-4 sm:space-y-6">
            {/* DASHBOARD HOME */}
            {activeDashboardTab === "dashboard" && (
              <div className="space-y-6 animate-[fadeIn_0.3s_ease]">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h1 className="mf-page-title">
                      {getTimeBasedGreeting(user.displayName)}
                    </h1>
                    <p className="mf-page-sub">
                      Speak any language—or mix several. Auto-detect → English minutes.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveDashboardTab("record")}
                    className="mf-btn mf-btn-primary"
                  >
                    <Mic className="w-5 h-5" />
                    Start Recording
                  </button>
                </div>

                {meetingCredits === 0 && !unlimitedCredits && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p className="text-sm text-amber-800 text-center sm:text-left">You need credits to process meetings.</p>
                    <button
                      type="button"
                      onClick={() => setActiveDashboardTab("credits")}
                      className="min-h-11 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold cursor-pointer shrink-0"
                    >
                      Buy Credits
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                  <button
                    type="button"
                    onClick={() => setActiveDashboardTab("history")}
                    className="mf-card mf-card-hover p-4 sm:p-5 text-left cursor-pointer"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Meetings</p>
                    <p className="text-2xl font-bold text-slate-900 mt-2">{history.length}</p>
                    <p className="text-xs text-slate-500 mt-1">Processed</p>
                  </button>

                  <div className="mf-card p-4 sm:p-5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">AI Minutes</p>
                    <p className="text-2xl font-bold text-slate-900 mt-2">{minutesGenerated}</p>
                    <p className="text-xs text-slate-500 mt-1">Generated</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveDashboardTab("credits")}
                    className="mf-card mf-card-hover p-4 sm:p-5 text-left cursor-pointer col-span-2 sm:col-span-1"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Credits</p>
                    <p className="text-2xl font-bold text-slate-900 mt-2">
                      {unlimitedCredits ? "∞" : meetingCredits}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">Remaining</p>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowOperationManual(true)}
                  className="text-sm text-slate-500 hover:text-blue-600 underline underline-offset-2 cursor-pointer"
                >
                  Open Operation Manual
                </button>
              </div>
            )}

            {/* BUY CREDITS */}
            {activeDashboardTab === "credits" && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h2 className="mf-page-title">Credits</h2>
                    <p className="mf-page-sub">Purchase credits to generate AI meeting minutes.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveDashboardTab("payments")}
                    className="mf-btn mf-btn-secondary"
                  >
                    Payment history
                  </button>
                </div>
                <BuyCreditsSection
                  formatPackagePrice={formatPackagePrice}
                  packagePriceRm={packagePriceRm}
                  creditPriceRm={CREDIT_PRICE_RM}
                  checkingOutPlan={checkingOutPlan}
                  onCheckout={handleCreditCheckout}
                  stripeConfigured={stripeConfigured}
                />
              </div>
            )}

            {/* RECORD & UPLOAD */}
            {activeDashboardTab === "record" && (
              <div className="space-y-5 sm:space-y-6 w-full">
                <RecordUploadPage
                  meetingTitle={meetingTitle}
                  onMeetingTitleChange={setMeetingTitle}
                  isRecording={isRecording}
                  isProcessing={isProcessing}
                  isSavingRecording={isSavingRecording}
                  recordingSeconds={recordingSeconds}
                  micLevel={micLevel}
                  micVoiceThreshold={MIC_VOICE_THRESHOLD}
                  pendingRecording={
                    pendingRecording
                      ? {
                          title: pendingRecording.title,
                          durationSeconds: pendingRecording.durationSeconds,
                          durationLabel: pendingRecording.durationLabel,
                        }
                      : null
                  }
                  onPendingTitleChange={(title) =>
                    setPendingRecording((prev) => (prev ? { ...prev, title } : prev))
                  }
                  activeInputMethod={activeInputMethod}
                  onInputMethodChange={(method) => {
                    setActiveInputMethod(method);
                    if (method === "stream") setDeviceError(null);
                  }}
                  dragActive={dragActive}
                  onDrag={handleDrag}
                  onDrop={handleDrop}
                  onFileChange={handleFileChange}
                  deviceError={deviceError}
                  onDismissDeviceError={() => setDeviceError(null)}
                  hasCredits={hasCredits}
                  creditPriceRm={CREDIT_PRICE_RM}
                  onBuyCredits={() => setActiveDashboardTab("credits")}
                  onStartRecording={startRecording}
                  onStopRecording={stopRecording}
                  onSaveRecording={savePendingRecording}
                  onGenerateMinutes={generateFromPendingRecording}
                  onDiscardRecording={discardPendingRecording}
                  processingStatus={processingStatus}
                  currentMinutes={currentMinutes}
                  formatTime={formatTime}
                  recentMeetings={history.slice(0, 5)}
                  onOpenMeeting={(item) => {
                    const full = history.find((h) => h.meetingId === item.meetingId);
                    if (full) viewHistoryItem(full);
                  }}
                  onOpenHistory={() => setActiveDashboardTab("history")}
                />

                {/* Keep existing minutes results / processing / transcript panel BELOW — preserve all handlers */}
                {(isProcessing || currentMinutes) && (
                  <div id="results-panel" className="space-y-6">
                    {/* Processing banner */}
                    {isProcessing && (
                      <div className="mf-card rounded-2xl sm:rounded-3xl p-8 sm:p-10 text-center space-y-4">
                        <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl border border-blue-100">
                          <Loader2 className="w-6 h-6 animate-spin" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-slate-900">Processing your meeting…</h3>
                          <p className="text-xs text-slate-500 mt-2 max-w-sm mx-auto leading-relaxed">
                            {processingStatus || "This usually takes a minute or two."}
                          </p>
                        </div>
                      </div>
                    )}
                    {/* Main Minutes results rendering */}
                    {currentMinutes && !isProcessing && (
                      <div className="mf-card rounded-3xl overflow-hidden animate-[fadeIn_0.3s_ease]">
                        <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                          <div className="space-y-1">
                            <h3 className="text-base font-bold text-slate-900 line-clamp-1">{meetingTitle || "Meeting Minutes"}</h3>
                            <p className="text-xs text-slate-500">Structured by {DISPLAY_GEMINI_MODEL}</p>
                          </div>
                        </div>

                        {/* Sub-tabs + sticky actions for mobile reading */}
                        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur-md flex flex-col gap-0 sm:flex-row sm:items-center sm:justify-between px-2 sm:px-3">
                          <div className="flex flex-1 min-w-0">
                            <button
                              type="button"
                              onClick={() => {
                                if (isReadingAloud) stopReadAloud();
                                setActiveTab("minutes");
                              }}
                              className={`flex-1 sm:flex-none py-3 px-3 sm:px-4 min-h-11 font-semibold text-xs border-b-2 transition-all cursor-pointer ${
                                activeTab === "minutes"
                                  ? "border-blue-600 text-blue-600 bg-blue-50/50"
                                  : "border-transparent text-slate-500 hover:text-slate-900"
                              }`}
                            >
                              <span className="sm:hidden">Minutes</span>
                              <span className="hidden sm:inline">Structured Minutes</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (isReadingAloud) stopReadAloud();
                                setActiveTab("transcript");
                              }}
                              className={`flex-1 sm:flex-none py-3 px-3 sm:px-4 min-h-11 font-semibold text-xs border-b-2 transition-all cursor-pointer ${
                                activeTab === "transcript"
                                  ? "border-blue-600 text-blue-600 bg-blue-50/50"
                                  : "border-transparent text-slate-500 hover:text-slate-900"
                              }`}
                            >
                              Transcript
                            </button>
                          </div>

                          {/* Quick Sharing Action Bar */}
                          <div className="flex items-center gap-2 py-2 overflow-x-auto sm:overflow-visible sm:flex-wrap sm:py-0 border-t sm:border-t-0 border-slate-100 sm:border-transparent">
                            {speechSupported && (
                              <>
                                {!isReadingAloud ? (
                                  <button
                                    type="button"
                                    onClick={() => void startReadAloud()}
                                    disabled={isPreparingSpeech}
                                    className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-emerald-700 bg-slate-50 hover:bg-emerald-50 min-h-11 px-3 py-2 rounded-lg border shrink-0 border-slate-200 hover:border-emerald-200 transition-all font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={`Read ${activeTab === "minutes" ? "minutes" : "transcript"} aloud`}
                                  >
                                    {isPreparingSpeech ? (
                                      <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                                    ) : (
                                      <Volume2 className="w-3.5 h-3.5 shrink-0" />
                                    )}
                                    {isPreparingSpeech ? "Preparing…" : "Read aloud"}
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={toggleReadAloudPause}
                                      className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 min-h-11 px-3 py-2 rounded-lg border shrink-0 border-amber-200 transition-all font-semibold cursor-pointer"
                                      title={isReadAloudPaused ? "Resume reading" : "Pause reading"}
                                    >
                                      {isReadAloudPaused ? (
                                        <Volume2 className="w-3.5 h-3.5 shrink-0" />
                                      ) : (
                                        <Pause className="w-3.5 h-3.5 shrink-0" />
                                      )}
                                      {isReadAloudPaused ? "Resume" : "Pause"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={stopReadAloud}
                                      className="inline-flex items-center gap-1.5 text-xs text-rose-700 bg-rose-50 hover:bg-rose-100 min-h-11 px-3 py-2 rounded-lg border shrink-0 border-rose-200 transition-all font-semibold cursor-pointer"
                                      title="Stop reading"
                                    >
                                      <Square className="w-3 h-3 shrink-0 fill-current" />
                                      Stop
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                const content = activeTab === "minutes" ? currentMinutes : currentTranscript;
                                if (content) {
                                  navigator.clipboard.writeText(content);
                                  if (activeTab === "minutes") {
                                    setCopiedMinutes(true);
                                    setTimeout(() => setCopiedMinutes(false), 2000);
                                  } else {
                                    setCopiedTranscript(true);
                                    setTimeout(() => setCopiedTranscript(false), 2000);
                                  }
                                  showNotification(`${activeTab === "minutes" ? "Minutes" : "Transcript"} copied to clipboard!`, "success");
                                }
                              }}
                              className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-blue-700 bg-slate-50 hover:bg-blue-50 min-h-11 px-3 py-2 rounded-lg border shrink-0 border-slate-200 hover:border-blue-200 transition-all font-semibold cursor-pointer"
                            >
                              {(activeTab === "minutes" ? copiedMinutes : copiedTranscript) ? "Copied!" : "Copy"}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                const content = activeTab === "minutes" ? currentMinutes : currentTranscript;
                                const title = meetingTitle || "Meeting Minutes";
                                if (content) {
                                  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "meeting";
                                  a.download = `${slug}-${activeTab}.txt`;
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                  URL.revokeObjectURL(url);
                                  showNotification("Text (.txt) downloaded successfully!", "success");
                                }
                              }}
                              className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-blue-700 bg-slate-50 hover:bg-blue-50 min-h-11 px-3 py-2 rounded-lg border shrink-0 border-slate-200 hover:border-blue-200 transition-all font-semibold cursor-pointer"
                            >
                              <FileDown className="w-3.5 h-3.5 shrink-0" />
                              Download
                            </button>
                          </div>
                        </div>

                        <div className="p-5 sm:p-6">
                          {activeTab === "minutes" ? (
                            <div className="prose prose-slate max-w-none text-[15px] sm:text-base text-slate-800 leading-relaxed prose-headings:text-slate-900 prose-headings:font-semibold prose-p:my-3">
                              <MarkdownRenderer content={currentMinutes} />
                            </div>
                          ) : (
                            <div className="text-slate-800 bg-slate-50 border border-slate-200 rounded-xl p-5 font-mono text-sm overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-[450px]">
                              {currentTranscript}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <ScrollDownHint
                  targetId={
                    isProcessing || currentMinutes
                      ? "results-panel"
                      : history.length > 0
                        ? "recent-meetings"
                        : null
                  }
                  label={
                    isProcessing
                      ? "Processing below — scroll for status"
                      : currentMinutes
                        ? "Minutes ready — scroll down to review"
                        : history.length > 0
                          ? "Recent meetings below"
                          : ""
                  }
                />
              </div>
            )}

            {/* TAB CONTENT: MEETING HISTORY */}
            {activeDashboardTab === "history" && (
              <div className="space-y-6 animate-[fadeIn_0.2s_ease]">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                  <div>
                    <h2 className="mf-page-title">Meeting History</h2>
                    <p className="mf-page-sub">
                      {history.length} meeting{history.length !== 1 ? "s" : ""} processed
                      {selectedHistoryIds.size > 0
                        ? ` · ${selectedHistoryIds.size} selected`
                        : ""}
                    </p>
                  </div>
                  {history.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={toggleSelectAllHistory}
                        className="mf-btn mf-btn-secondary text-xs min-h-11 px-3 py-2"
                      >
                        {selectedHistoryIds.size === history.length ? (
                          <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                        {selectedHistoryIds.size === history.length ? "Deselect all" : "Select all"}
                      </button>
                      <button
                        type="button"
                        onClick={() => bulkDeleteHistory("selected")}
                        disabled={isBulkDeleting || selectedHistoryIds.size === 0}
                        className="mf-btn mf-btn-danger text-xs min-h-11 px-3 py-2"
                      >
                        {isBulkDeleting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        Delete selected
                      </button>
                      <button
                        type="button"
                        onClick={() => bulkDeleteHistory("all")}
                        disabled={isBulkDeleting}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        Clear all history
                      </button>
                    </div>
                  )}
                </div>

                {history.length === 0 ? (
                  <div className="mf-card p-12 text-center space-y-4">
                    <History className="w-10 h-10 text-blue-600 mx-auto opacity-60" />
                    <h4 className="text-base font-semibold text-slate-900">No meetings yet</h4>
                    <p className="text-sm text-slate-500">Processed meetings will appear here.</p>
                    <button
                      type="button"
                      onClick={() => setActiveDashboardTab("record")}
                      className="mf-btn mf-btn-primary"
                    >
                      <Mic className="w-4 h-4" />
                      Process Your First Meeting
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Phone: card list */}
                    <div className="md:hidden space-y-3">
                      {history.map((item) => (
                        <div
                          key={item.meetingId}
                          className={`mf-card p-4 space-y-3 ${
                            selectedHistoryIds.has(item.meetingId)
                              ? "border-blue-300 ring-2 ring-blue-50"
                              : ""
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              onClick={(e) => toggleHistorySelection(item.meetingId, e)}
                              className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 cursor-pointer shrink-0"
                              title={selectedHistoryIds.has(item.meetingId) ? "Deselect" : "Select"}
                            >
                              {selectedHistoryIds.has(item.meetingId) ? (
                                <CheckSquare className="w-5 h-5 text-blue-600" />
                              ) : (
                                <Square className="w-5 h-5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                viewHistoryItem(item);
                                setActiveDashboardTab("record");
                              }}
                              className="flex-1 min-w-0 text-left cursor-pointer"
                            >
                              <p className="text-base font-semibold text-slate-900 truncate">{item.title}</p>
                              <p className="text-sm text-slate-500 mt-1">
                                {item.date} · {item.duration}
                              </p>
                              {item.minutes ? (
                                <span className="inline-block mt-1.5 text-xs tracking-wide text-emerald-600 font-semibold">
                                  Minutes Ready
                                </span>
                              ) : item.hasAudio ? (
                                <span className="inline-block mt-1.5 text-xs tracking-wide text-blue-600 font-semibold">
                                  Recording saved
                                </span>
                              ) : (
                                <span className="inline-block mt-1.5 text-xs tracking-wide text-slate-400 font-semibold">
                                  In progress
                                </span>
                              )}
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 pl-1">
                            {item.hasAudio && (
                              <>
                                <button
                                  type="button"
                                  onClick={(e) => downloadMeetingAudio(item, e)}
                                  className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-xs font-semibold text-slate-600 border border-slate-200 hover:border-emerald-300 hover:text-emerald-700 cursor-pointer"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  Audio
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => redoMeetingMinutes(item, e)}
                                  disabled={
                                    !!redoingMeetingId ||
                                    isProcessing ||
                                    (!hasCredits && !item.freeRedoEligible)
                                  }
                                  className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-xs font-semibold text-blue-600 border border-blue-200 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  {redoingMeetingId === item.meetingId ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  )}
                                  {item.minutes
                                    ? item.freeRedoEligible
                                      ? "Free Redo"
                                      : "Redo"
                                    : "Generate"}
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={(e) => deleteHistoryItem(item.meetingId, e)}
                              className={`inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                                deleteConfirmId === item.meetingId
                                  ? "text-rose-700 bg-rose-50 border border-rose-200"
                                  : "text-slate-500 border border-slate-200 hover:text-rose-600"
                              }`}
                            >
                              {deleteConfirmId === item.meetingId ? "Confirm" : <Trash2 className="w-4 h-4" />}
                              {deleteConfirmId === item.meetingId ? "" : "Delete"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop / tablet: table */}
                    <div className="hidden md:block mf-card overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 text-sm text-slate-500 border-b border-slate-200">
                              <th className="py-4 px-4 font-semibold w-12">
                                <button
                                  type="button"
                                  onClick={toggleSelectAllHistory}
                                  className="p-1 rounded text-slate-400 hover:text-blue-600 cursor-pointer"
                                  title={selectedHistoryIds.size === history.length ? "Deselect all" : "Select all"}
                                >
                                  {selectedHistoryIds.size === history.length && history.length > 0 ? (
                                    <CheckSquare className="w-4 h-4 text-blue-600" />
                                  ) : (
                                    <Square className="w-4 h-4" />
                                  )}
                                </button>
                              </th>
                              <th className="py-4 px-6 font-semibold">Meeting</th>
                              <th className="py-4 px-6 font-semibold">Date</th>
                              <th className="py-4 px-6 font-semibold">Duration</th>
                              <th className="py-4 px-6 font-semibold text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {history.map((item) => (
                              <tr
                                key={item.meetingId}
                                onClick={() => {
                                  viewHistoryItem(item);
                                  setActiveDashboardTab("record");
                                }}
                                className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                                  selectedHistoryIds.has(item.meetingId) ? "bg-blue-50/50" : ""
                                }`}
                              >
                                <td className="py-4 px-4" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={(e) => toggleHistorySelection(item.meetingId, e)}
                                    className="p-1 rounded text-slate-400 hover:text-blue-600 cursor-pointer"
                                    title={selectedHistoryIds.has(item.meetingId) ? "Deselect" : "Select"}
                                  >
                                    {selectedHistoryIds.has(item.meetingId) ? (
                                      <CheckSquare className="w-4 h-4 text-blue-600" />
                                    ) : (
                                      <Square className="w-4 h-4" />
                                    )}
                                  </button>
                                </td>
                                <td className="py-4 px-6">
                                  <div className="flex flex-col gap-1">
                                    <span className="text-sm font-medium text-slate-900">{item.title}</span>
                                    {item.minutes ? (
                                      <span className="text-xs uppercase tracking-wide text-emerald-600 font-semibold">
                                        Ready
                                      </span>
                                    ) : item.hasAudio ? (
                                      <span className="text-xs uppercase tracking-wide text-blue-600 font-semibold">
                                        Saved
                                      </span>
                                    ) : (
                                      <span className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
                                        —
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-4 px-6 text-sm text-slate-500">{item.date}</td>
                                <td className="py-4 px-6 text-sm text-slate-500">{item.duration}</td>
                                <td className="py-4 px-6 text-right">
                                  <div className="inline-flex items-center gap-1 justify-end">
                                    {item.hasAudio && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={(e) => downloadMeetingAudio(item, e)}
                                          className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all"
                                          title="Download recording"
                                        >
                                          <Download className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => redoMeetingMinutes(item, e)}
                                          disabled={
                                            !!redoingMeetingId ||
                                            isProcessing ||
                                            (!hasCredits && !item.freeRedoEligible)
                                          }
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                          title={
                                            item.freeRedoEligible
                                              ? "Free redo (within 24h)"
                                              : !hasCredits
                                              ? "Need 1 credit"
                                              : item.minutes
                                              ? "Redo minutes (1 credit; then free for 24h)"
                                              : "Generate minutes (1 credit; then free redo for 24h)"
                                          }
                                        >
                                          {redoingMeetingId === item.meetingId ? (
                                            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                                          ) : (
                                            <RefreshCw className="w-3.5 h-3.5" />
                                          )}
                                          {item.minutes
                                            ? item.freeRedoEligible
                                              ? "Free Redo"
                                              : "Redo"
                                            : "Generate"}
                                        </button>
                                      </>
                                    )}
                                    <button
                                      type="button"
                                      onClick={(e) => deleteHistoryItem(item.meetingId, e)}
                                      className={`p-2 rounded-lg transition-all ${
                                        deleteConfirmId === item.meetingId
                                          ? "text-rose-600 bg-rose-50 text-sm font-semibold px-3"
                                          : "text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                      }`}
                                      title={deleteConfirmId === item.meetingId ? "Click again to confirm" : "Delete"}
                                    >
                                      {deleteConfirmId === item.meetingId ? "Confirm" : <Trash2 className="w-4 h-4" />}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* TAB CONTENT: PAYMENTS & BILLING */}
            {activeDashboardTab === "payments" && (
              <div className="space-y-6 animate-[fadeIn_0.2s_ease]">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h2 className="mf-page-title">Payments &amp; Billing</h2>
                    <p className="mf-page-sub">
                      {unlimitedCredits
                        ? "Unlimited credits · Developer account"
                        : `${meetingCredits} credit${meetingCredits !== 1 ? "s" : ""} available · Pay As You Go`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveDashboardTab("credits")}
                    className="mf-btn mf-btn-primary shrink-0"
                  >
                    Buy More Credits
                  </button>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-slate-700">Invoice History</h3>

                  {paymentsHistory.length === 0 ? (
                    <div className="mf-card p-8 text-center text-sm text-slate-500">
                      No transactions found for this account.
                    </div>
                  ) : (
                    <>
                      <div className="md:hidden space-y-3">
                        {paymentsHistory.map((invoice) => (
                          <div
                            key={invoice.id}
                            className="mf-card p-4 space-y-2"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900">
                                  {invoice.creditsPurchased
                                    ? `${invoice.creditsPurchased} Credit${invoice.creditsPurchased !== 1 ? "s" : ""}`
                                    : invoice.packageId === "credits_1"
                                    ? "1 Credit"
                                    : invoice.packageId === "credits_5"
                                    ? "5 Credits"
                                    : invoice.packageId === "credits_10"
                                    ? "10 Credits"
                                    : invoice.packageId || "Credits"}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">
                                  {invoice.createdAt
                                    ? new Date(
                                        invoice.createdAt._seconds
                                          ? invoice.createdAt._seconds * 1000
                                          : invoice.createdAt
                                      ).toLocaleString()
                                    : "—"}
                                </p>
                              </div>
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                                {invoice.status || "Paid"}
                              </span>
                            </div>
                            <p className="text-base font-semibold text-slate-900">
                              RM{" "}
                              {invoice.amount
                                ? (invoice.amount / 100).toFixed(2)
                                : invoice.amountPaid
                                ? (invoice.amountPaid / 100).toFixed(2)
                                : `${CREDIT_PRICE_RM}.00`}
                            </p>
                          </div>
                        ))}
                      </div>

                      <div className="hidden md:block mf-card overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 text-sm text-slate-500 border-b border-slate-200">
                                <th className="py-4 px-6 font-semibold">Transaction / Date</th>
                                <th className="py-4 px-6 font-semibold">Package</th>
                                <th className="py-4 px-6 font-semibold text-right">Amount</th>
                                <th className="py-4 px-6 font-semibold text-center">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {paymentsHistory.map((invoice) => (
                                <tr key={invoice.id} className="hover:bg-slate-50">
                                  <td className="py-4 px-6">
                                    <div className="text-sm font-medium text-slate-700 truncate max-w-[200px]">{invoice.id}</div>
                                    <div className="text-sm text-slate-500 mt-0.5">
                                      {invoice.createdAt
                                        ? new Date(invoice.createdAt._seconds ? invoice.createdAt._seconds * 1000 : invoice.createdAt).toLocaleString()
                                        : "—"}
                                    </div>
                                  </td>
                                  <td className="py-4 px-6 text-sm text-slate-700">
                                    {invoice.creditsPurchased
                                      ? `${invoice.creditsPurchased} Credit${invoice.creditsPurchased !== 1 ? "s" : ""}`
                                      : invoice.packageId === "credits_1" ? "1 Credit" :
                                     invoice.packageId === "credits_5" ? "5 Credits" :
                                     invoice.packageId === "credits_10" ? "10 Credits" :
                                     invoice.packageId || "Credits"}
                                  </td>
                                  <td className="py-4 px-6 text-right text-sm font-semibold text-slate-900">
                                    RM {invoice.amount ? (invoice.amount / 100).toFixed(2) : invoice.amountPaid ? (invoice.amountPaid / 100).toFixed(2) : `${CREDIT_PRICE_RM}.00`}
                                  </td>
                                  <td className="py-4 px-6 text-center">
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      {invoice.status || "Paid"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: ACCOUNT SETTINGS */}
            {activeDashboardTab === "settings" && (
              <div className="max-w-2xl space-y-6 animate-[fadeIn_0.2s_ease]">
                <div>
                  <h2 className="mf-page-title">Account Settings</h2>
                  <p className="mf-page-sub">Manage your profile and connections</p>
                </div>

                <div className="mf-card p-6 space-y-6">
                  <div className="flex items-center gap-4 border-b border-slate-200 pb-6">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt="Avatar"
                        className="w-16 h-16 rounded-full border border-slate-200 object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-blue-600 text-lg">
                        {getUserInitials()}
                      </div>
                    )}
                    <div className="space-y-1">
                      <h3 className="text-base font-bold text-slate-900">{user.displayName}</h3>
                      <p className="text-sm text-slate-500">{user.email}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-sm font-semibold text-slate-700">Appearance</h4>
                    <p className="text-sm text-slate-500">
                      Choose light, dark, or match your device setting.
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: "light" as const, label: "Light", icon: Sun },
                          { id: "dark" as const, label: "Dark", icon: Moon },
                          { id: "system" as const, label: "System", icon: Monitor },
                        ] as const
                      ).map(({ id, label, icon: Icon }) => {
                        const active = themePreference === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => {
                              setThemePreferenceState(id);
                              setThemePreference(id);
                            }}
                            className={`min-h-11 px-3 rounded-xl border text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                              active
                                ? "border-blue-500 bg-blue-50 text-blue-700"
                                : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                            }`}
                            aria-pressed={active}
                          >
                            <Icon className="w-4 h-4 shrink-0" />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-sm font-semibold text-slate-700">Connections</h4>
                    <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div className="flex items-center gap-3">
                        <Globe className="w-5 h-5 text-blue-600" />
                        <div>
                          <p className="text-sm font-medium text-slate-800">Google Account</p>
                          <p className="text-sm text-slate-500">Sign-in &amp; authentication</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-2 h-2 bg-emerald-500 rounded-full" />
                        Connected
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <span className="text-sm text-slate-500 block">Credits Balance</span>
                      <span className="text-lg font-bold text-blue-600 block mt-1">
                        {unlimitedCredits ? "Unlimited" : meetingCredits}
                      </span>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <span className="text-sm text-slate-500 block">Meetings Processed</span>
                      <span className="text-lg font-bold text-slate-900 block mt-1">{history.length}</span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="flex-1 mf-btn mf-btn-secondary"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                    <h4 className="text-sm font-semibold text-slate-700">Help</h4>
                    <p className="text-sm text-slate-500">
                      Step-by-step guide for recording, credits, generate, and download.
                    </p>
                    <ManualLink onOpen={() => setShowOperationManual(true)} className="pt-1" />
                  </div>

                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                    <h4 className="text-sm font-semibold text-slate-700">Legal</h4>
                    <p className="text-sm text-slate-500">
                      Review how we handle meeting data, Google Sign-In, and Stripe payments.
                    </p>
                    <LegalLinks onOpen={setLegalDocType} className="pt-1" />
                    <AiDisclaimer className="pt-1" />
                  </div>

                  <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 space-y-3">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h4 className="text-sm font-semibold text-rose-700">Delete Account</h4>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          Permanently delete your account, meeting history, and remaining credits. This cannot be undone.
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={isDeletingAccount}
                        onClick={handleDeleteAccount}
                        className="px-4 py-2.5 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer"
                      >
                        {isDeletingAccount ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                        {isDeletingAccount ? "Deleting..." : "Delete Account"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DashboardLayout>
      )}

      {legalDocType && (
        <LegalModal type={legalDocType} onClose={() => setLegalDocType(null)} />
      )}
      {showOperationManual && (
        <OperationManualModal onClose={() => setShowOperationManual(false)} />
      )}

      {/* GOOGLE SIGN-IN TROUBLESHOOTING MODAL */}
      {showTroubleshootModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-[fadeIn_0.2s_ease]">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full overflow-hidden shadow-xl relative p-6 sm:p-8 space-y-6">
            {/* Close button */}
            <button
              type="button"
              onClick={() => setShowTroubleshootModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 p-2 rounded-full transition-all cursor-pointer z-10"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>

            <div className="space-y-2">
              <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center border border-amber-200">
                <AlertCircle className="w-6 h-6 animate-pulse" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Google Sign-In Help &amp; Options</h3>
              <p className="text-xs text-slate-500">
                Are you having trouble connecting your Google account in the AI Studio preview? Read on.
              </p>
            </div>

            {authErrorMessage && (
              <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl">
                <p className="text-[10px] font-bold text-rose-600 uppercase tracking-wide mb-1 font-mono">Last Error Message:</p>
                <p className="text-xs text-rose-700 font-mono break-all">{authErrorMessage}</p>
              </div>
            )}

            <div className="space-y-4 text-xs text-slate-600 leading-relaxed font-sans">
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0 font-bold font-mono text-[10px]">1</div>
                <div>
                  <strong className="text-slate-800 font-semibold">The Iframe Limitation (Highly Likely)</strong>
                  <p className="text-slate-500 mt-1">
                    Standard Google Sign-In popups are blocked inside nested frames due to security policies.
                  </p>
                  <p className="text-blue-600 font-semibold mt-1">
                    👉 Click the <strong className="text-blue-700">"Open in New Tab"</strong> button in the top-right corner of your preview panel to run the app standalone. Popups work perfectly there!
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0 font-bold font-mono text-[10px]">2</div>
                <div>
                  <strong className="text-slate-800 font-semibold">Authorized Domains Configuration</strong>
                  <p className="text-slate-500 mt-1">
                    Firebase Auth restricts logins to authorized domains. If deploying custom URLs, add this URL as an authorized domain:
                  </p>
                  <div className="mt-2 p-2 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between gap-2 font-mono text-[10px] text-slate-500 truncate">
                    <span>{window.location.origin}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(window.location.origin);
                        showNotification("Domain copied to clipboard!", "success");
                      }}
                      className="px-2 py-1 bg-blue-50 hover:bg-blue-600 text-blue-600 hover:text-white rounded transition-all cursor-pointer text-[9px]"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => setShowTroubleshootModal(false)}
                className="mf-btn mf-btn-secondary w-full text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SIMULATED CHECKOUT OVERLAY (dev only) */}
      {showSimulatedCheckout && !import.meta.env.PROD && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-[fadeIn_0.2s_ease]">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full overflow-hidden shadow-xl relative">
            <div className="bg-slate-50 p-6 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Secure Sandbox Checkout</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSimulatedCheckout(false)}
                className="text-slate-400 hover:text-slate-700 bg-white hover:bg-slate-100 p-1.5 rounded-full border border-slate-200 transition-all cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-[10px] font-mono justify-center">
                <Shield className="w-3.5 h-3.5 text-emerald-600" />
                <span>SECURE SEC REINFORCED ENVIRONMENT</span>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Meeting Credits</span>
                  <span className="font-bold text-blue-600 font-mono">
                    {purchaseQuantity} Credit{purchaseQuantity !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 mt-2 text-xs">
                  <span className="text-slate-700 font-semibold">Price Payable</span>
                  <span className="font-black text-slate-900 font-mono">
                    {formatPackagePriceDecimal(purchaseQuantity)}
                  </span>
                </div>
              </div>

              {/* Sandbox Card Details Form */}
              <div className="space-y-4">
                <div>
                  <label className="mf-label">
                    Cardholder Name
                  </label>
                  <input
                    type="text"
                    defaultValue={user?.displayName || "John Doe"}
                    className="mf-input text-base"
                  />
                </div>

                <div>
                  <label className="mf-label">
                    Card Number
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      defaultValue="4242 •••• •••• 4242"
                      className="mf-input text-base pr-10"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <CreditCard className="w-4 h-4 text-slate-400" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mf-label">
                      Expiry Date
                    </label>
                    <input
                      type="text"
                      defaultValue="12 / 29"
                      className="mf-input text-base text-center"
                    />
                  </div>
                  <div>
                    <label className="mf-label">
                      CVC / CVV
                    </label>
                    <input
                      type="text"
                      defaultValue="123"
                      className="mf-input text-base text-center"
                    />
                  </div>
                </div>
              </div>

              {/* simulated checkout click */}
              <button
                type="button"
                disabled={isProcessingSimulatedPayment}
                onClick={() => handleAuthorizeSimulatedPayment(purchaseQuantity)}
                className="w-full mf-btn mf-btn-primary disabled:opacity-50"
              >
                {isProcessingSimulatedPayment ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Authorizing Sandbox payment...</span>
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4" />
                    <span>Authorize Sandbox Payment</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
