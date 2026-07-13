import React, { useState, useEffect, useRef } from "react";
import {
  Mic,
  Square,
  FileText,
  History,
  Loader2,
  Sparkles,
  Trash2,
  FileDown,
  Clock,
  Globe,
  Upload,
  AlertCircle,
  CreditCard,
  Shield,
  LogOut,
} from "lucide-react";
import { DashboardLayout, type DashboardTab } from "./components/DashboardLayout";
import { Toast } from "./components/Toast";
import { BuyCreditsSection } from "./components/BuyCreditsSection";
import { LegalModal, LegalLinks, type LegalDocType } from "./components/LegalModal";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from "firebase/auth";

// Local storage key for meeting history
const HISTORY_KEY = "meeting_minutes_history";

const DISPLAY_GEMINI_MODEL = "Gemini 3.5 Flash";

/** Minimum usable capture before we bother uploading / charging. */
const MIN_RECORDING_SECONDS = 3;
/** WebM headers alone can exceed 2KB — require a bit more for live captures. */
const MIN_AUDIO_BYTES = 4096;

function formatGeminiModelLabel(_modelId?: string | null): string {
  // Always show 3.5 — never surface a stale 1.5 label from old health payloads or caches.
  return DISPLAY_GEMINI_MODEL;
}

function isNoSpeechContent(transcript?: string | null, minutes?: string | null): boolean {
  const blob = `${transcript || ""}\n${minutes || ""}`.toLowerCase();
  return (
    blob.includes("no intelligible speech") ||
    blob.includes("no speech detected") ||
    blob.includes("### no speech detected")
  );
}

const CREDIT_PRICE_RM = 39;
const packagePriceRm = (credits: number) => {
  if (credits === 1) return 39;
  if (credits === 5) return 195;
  if (credits === 10) return 390;
  return credits * CREDIT_PRICE_RM;
};
const creditsToPackageId = (credits: number): string | null => {
  if (credits === 1) return "credits_1";
  if (credits === 5) return "credits_5";
  if (credits === 10) return "credits_10";
  return null;
};
const formatPackagePrice = (credits: number) => `RM${packagePriceRm(credits)}`;
const formatPackagePriceDecimal = (credits: number) => `RM ${packagePriceRm(credits).toFixed(2)}`;

interface MeetingItem {
  meetingId: string;
  title: string;
  date: string;
  duration: string; // in seconds formatted as hh:mm:ss
  transcript: string;
  minutes: string;
}

// Simple inline parser for markdown bold text
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold text-indigo-300">
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
            <h4 key={idx} className="text-sm font-semibold text-indigo-400 uppercase tracking-wider mt-5 mb-1.5 font-sans">
              {renderInlineMarkdown(trimmed.substring(4))}
            </h4>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h3 key={idx} className="text-base font-bold text-slate-100 tracking-tight border-b border-slate-800/80 pb-1 mt-6 mb-2 font-sans">
              {renderInlineMarkdown(trimmed.substring(3))}
            </h3>
          );
        }
        if (trimmed.startsWith("# ")) {
          return (
            <h2 key={idx} className="text-lg font-extrabold text-slate-100 tracking-tight mt-8 mb-3 font-sans">
              {renderInlineMarkdown(trimmed.substring(2))}
            </h2>
          );
        }

        // Horizontal Rules
        if (trimmed === "---" || trimmed === "***") {
          return <hr key={idx} className="border-slate-800 my-4" />;
        }

        // Bullet lists
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
          // Split by newline containing list start
          const items = trimmed.split(/\n\s*[-*•]\s+/);
          return (
            <ul key={idx} className="list-disc pl-5 space-y-2 text-xs sm:text-sm text-slate-300 leading-relaxed font-sans">
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
            <ol key={idx} className="list-decimal pl-5 space-y-2 text-xs sm:text-sm text-slate-300 leading-relaxed font-sans">
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
          <p key={idx} className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans">
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
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // SaaS states
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem("minutesflow_hide_onboarding") !== "true";
  });
  const [copiedMinutes, setCopiedMinutes] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);

  // Subscription / Monetization states (Extended for credits)
  const [checkingOutPlan, setCheckingOutPlan] = useState<number | null>(null);
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [showSimulatedCheckout, setShowSimulatedCheckout] = useState(false);
  const [isProcessingSimulatedPayment, setIsProcessingSimulatedPayment] = useState(false);
  const [purchaseQuantity, setPurchaseQuantity] = useState<number>(1);

  // Credits & Dashboard states
  const [meetingCredits, setMeetingCredits] = useState<number>(0);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string>("none");
  const [paymentsHistory, setPaymentsHistory] = useState<any[]>([]);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardTab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const showNotification = (message: string, type: "success" | "error" | "info" = "info") => {
    setNotification({ message, type });
    // Auto-dismiss after 6 seconds
    setTimeout(() => {
      setNotification((prev) => prev?.message === message ? null : prev);
    }, 6000);
  };

  /** Stale servers/clients still calling retired Gemini models — force a hard reload. */
  const notifyOrReloadIfStaleModel = (raw: unknown, fallbackPrefix: string) => {
    const message = typeof raw === "string" ? raw : (raw as any)?.message ? String((raw as any).message) : String(raw ?? "");
    if (/gemini-(1\.5|2\.5)-flash/i.test(message)) {
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
    if (currentUser?.uid === "sandbox_user_123") {
      return headers;
    }
    try {
      const auth = getAuth();
      const firebaseUser = (currentUser as FirebaseUser) || auth.currentUser;
      if (firebaseUser && firebaseUser.uid !== "sandbox_user_123" && "getIdToken" in firebaseUser) {
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
  const chunksCountRef = useRef(0);
  const currentMeetingIdRef = useRef<string | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const selectedMimeRef = useRef<string>("audio/webm");

  // Sync user profile state and histories from server
  const refreshUserProfile = async (currentUser: any) => {
    if (!currentUser) return;
    try {
      const url = `/api/user/profile?userId=${currentUser.uid}&email=${encodeURIComponent(currentUser.email || "")}&displayName=${encodeURIComponent(currentUser.displayName || "")}&photoURL=${encodeURIComponent(currentUser.photoURL || "")}`;
      const res = await fetch(url, { headers: await getApiHeaders(currentUser) });
      if (res.ok) {
        const data = await res.json();
        setMeetingCredits(data.meetingCredits || 0);
        setSubscriptionStatus(data.subscriptionStatus || "none");
      }
      
      // Fetch histories
      await fetchHistories(currentUser.uid, currentUser);
    } catch (e) {
      console.error("Error syncing user profile with server:", e);
    }
  };

  const fetchHistories = async (userId: string, currentUser?: FirebaseUser | { uid: string } | null) => {
    try {
      const authHeaders = await getApiHeaders(currentUser || { uid: userId });
      const paymentsRes = await fetch(`/api/payments/history?userId=${userId}`, { headers: authHeaders });
      if (paymentsRes.ok) {
        const paymentsData = await paymentsRes.json();
        setPaymentsHistory(paymentsData);
      }

      const meetingsRes = await fetch(`/api/meetings/history?userId=${userId}`, { headers: authHeaders });
      if (meetingsRes.ok) {
        const meetingsData = await meetingsRes.json();
        if (meetingsData && meetingsData.length > 0) {
          const formattedMeetings: MeetingItem[] = meetingsData.map((m: any) => ({
            meetingId: m.id,
            title: m.title,
            date: m.createdAt 
              ? new Date(m.createdAt._seconds ? m.createdAt._seconds * 1000 : m.createdAt).toLocaleDateString() + " " + new Date(m.createdAt._seconds ? m.createdAt._seconds * 1000 : m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
              : "Processed",
            duration: m.duration ? formatTime(m.duration) : "File Upload",
            transcript: m.transcript || m.summary || "",
            minutes: m.minutes,
          }));
          setHistory(formattedMeetings);
          localStorage.setItem(HISTORY_KEY, JSON.stringify(formattedMeetings));
        }
      }
    } catch (err) {
      console.error("Failed to fetch user histories:", err);
    }
  };

  // Fetch Firebase Config and Health Check on mount
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
            setUser(firebaseUser);
            if (firebaseUser) {
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
              }
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

      // Load History
      const savedHistory = localStorage.getItem(HISTORY_KEY);
      if (savedHistory) {
        try {
          setHistory(JSON.parse(savedHistory));
        } catch (e) {
          console.error("Error parsing history from local storage:", e);
        }
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

    initApp();
  }, []);

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
        setHistory([]);
        localStorage.removeItem(HISTORY_KEY);
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

  // Skip Sign-In with Local Sandbox Session
  const handleSandboxSignIn = async () => {
    setAuthLoading(true);
    try {
      const sandboxUser = {
        uid: "sandbox_user_123",
        email: "sandbox@example.com",
        displayName: "Sandbox Explorer",
        photoURL: ""
      };
      setUser(sandboxUser as any);
      await refreshUserProfile(sandboxUser);
      setAuthInitialized(true);
      showNotification("⚡ Signed in with Local Sandbox Session successfully!", "success");
      setShowTroubleshootModal(false);
    } catch (err: any) {
      console.error("Sandbox sign in failed:", err);
      showNotification("Failed to initialize sandbox session.", "error");
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout
  const handleSignOut = async () => {
    try {
      const auth = getAuth();
      if (user?.uid !== "sandbox_user_123") {
        await signOut(auth);
      }
      setUser(null);
      setMeetingCredits(0);
      setHistory([]);
      localStorage.removeItem(HISTORY_KEY);
      showNotification("Signed out successfully.", "success");
    } catch (err) {
      console.error("Sign out failed:", err);
    }
  };

  // Start continuous chunked recording
  const startRecording = async () => {
    if (!user) return;
    if (meetingCredits <= 0) {
      showNotification("You need at least 1 meeting credit (RM39) to start recording. Purchase credits to continue.", "error");
      setActiveDashboardTab("credits");
      return;
    }
    try {
      // Clear previous outputs
      setCurrentMinutes(null);
      setCurrentTranscript(null);
      setDeviceError(null);

      // Prefer a real microphone track (not a muted/disabled default).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length || audioTracks.every((t) => t.readyState !== "live" || t.muted)) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("No live microphone audio track available");
      }
      console.log(
        "Mic tracks:",
        audioTracks.map((t) => `${t.label || "unnamed"} ready=${t.readyState} muted=${t.muted} enabled=${t.enabled}`)
      );

      // Generate a brand new meeting ID
      const newMeetingId = `mtg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      setMeetingId(newMeetingId);
      currentMeetingIdRef.current = newMeetingId;

      setRecordingSeconds(0);
      setChunksUploaded(0);
      chunksCountRef.current = 0;
      recordedChunksRef.current = [];

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
      console.log(`Starting MediaRecorder with mimeType: ${selectedMime}`);

      // Timeslice of 5 seconds to collect chunks in memory
      const options = { mimeType: selectedMime };
      const mediaRecorder = new MediaRecorder(stream, options);
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

  // Stop recording and trigger AI Processing
  const stopRecording = async () => {
    if (!isRecording || !mediaRecorderRef.current || !user) return;

    setIsRecording(false);
    clearInterval(timerIntervalRef.current);

    const activeId = meetingId;
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

    const finalBlob = new Blob(recordedChunksRef.current, { type: selectedMimeRef.current });
    console.log(
      `Recording stopped: ${finalSeconds}s, ${recordedChunksRef.current.length} chunks, blob=${finalBlob.size} bytes, mime=${selectedMimeRef.current}`
    );

    // Fail before upload/charge when capture is empty or too short
    if (finalSeconds < MIN_RECORDING_SECONDS || finalBlob.size < MIN_AUDIO_BYTES) {
      setIsProcessing(false);
      setMeetingId(null);
      currentMeetingIdRef.current = null;
      setRecordingSeconds(0);
      setChunksUploaded(0);
      recordedChunksRef.current = [];
      showNotification(
        "Recording too short / no audio captured. Hold for at least a few seconds, speak clearly into your mic, then stop.",
        "error"
      );
      return;
    }

    // Switch to processing stage
    setIsProcessing(true);
    setProcessingStatus("Assembling audio and uploading securely...");

    try {
      setProcessingStatus(`Translating, transcribing and structuring meeting minutes with ${geminiModelLabel}...`);

      const clientDateTime = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
      const titleToUse = meetingTitle.trim() || `Meeting on ${new Date().toLocaleDateString()}`;

      const response = await fetch(
        `/api/recording/upload?title=${encodeURIComponent(titleToUse)}&mimeType=${encodeURIComponent(selectedMimeRef.current)}&clientDateTime=${encodeURIComponent(clientDateTime)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-user-id": user.uid,
            ...(await getApiHeaders(user)),
          },
          body: finalBlob,
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
              errorMessage = errorData.message || "Recording too short / no audio captured. Check your microphone and try again.";
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
      setActiveTab("minutes");

      // Sync credits & billing info if returned
      if (data.meetingCreditsRemaining !== undefined) {
        setMeetingCredits(data.meetingCreditsRemaining);
      }

      if (data.noSpeechDetected || isNoSpeechContent(data.transcript, data.minutes)) {
        showNotification(
          data.creditCharged === false
            ? "No speech detected in the recording. Your credit was not charged. Check your mic and try again."
            : "No speech detected in the recording. Check your microphone and try again.",
          "info"
        );
      }

      // Refresh Firestore lists to get newly added item
      await refreshUserProfile(user);

      // Save to local history list
      const newHistoryItem: MeetingItem = {
        meetingId: activeId!,
        title: titleToUse,
        date: new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        duration: finalDuration,
        transcript: data.transcript,
        minutes: data.minutes,
      };

      const updatedHistory = [newHistoryItem, ...history];
      setHistory(updatedHistory);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));

    } catch (error: any) {
      console.error("Meeting minutes processing failed:", error);
      notifyOrReloadIfStaleModel(error?.message ?? error, "Processing Failed");
    } finally {
      setIsProcessing(false);
      setMeetingId(null);
      currentMeetingIdRef.current = null;
      setRecordingSeconds(0);
      setChunksUploaded(0);
    }
  };

  // Load a historic meeting item to view details
  const viewHistoryItem = (item: MeetingItem) => {
    setMeetingTitle(item.title);
    setCurrentMinutes(item.minutes);
    setCurrentTranscript(item.transcript);
    setActiveTab("minutes");
    // Scroll window smoothly to results panel
    const element = document.getElementById("results-panel");
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Delete an item from history log
  const deleteHistoryItem = (idToDelete: string, e: React.MouseEvent) => {
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
    const updated = history.filter((item) => item.meetingId !== idToDelete);
    setHistory(updated);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));

    // Reset current active states if viewing deleted item
    if (meetingId === idToDelete || (currentMinutes && history.find(h => h.meetingId === idToDelete)?.minutes === currentMinutes)) {
      setCurrentMinutes(null);
      setCurrentTranscript(null);
    }
    showNotification("Meeting deleted from local history.", "info");
  };

  // Direct Audio File Upload Processing
  const handleAudioUpload = async (file: File) => {
    if (!user) return;
    if (!file) return;

    if (meetingCredits <= 0) {
      showNotification("You need at least 1 meeting credit (RM39) to upload audio. Purchase credits to continue.", "error");
      setActiveDashboardTab("credits");
      return;
    }

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

    // Clear previous results & notifications
    setCurrentMinutes(null);
    setCurrentTranscript(null);
    setDeviceError(null);

    setIsProcessing(true);
    setProcessingStatus(`Uploading "${file.name}" to the server and streaming to Gemini AI...`);

    try {
      const clientDateTime = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
      const titleToUse = meetingTitle.trim() || file.name.replace(/\.[^/.]+$/, "") || "Uploaded Meeting";
      
      const response = await fetch(
        `/api/recording/upload?title=${encodeURIComponent(titleToUse)}&mimeType=${encodeURIComponent(file.type || "audio/webm")}&clientDateTime=${encodeURIComponent(clientDateTime)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-user-id": user.uid,
            ...(await getApiHeaders(user)),
          },
          body: file,
        }
      );

      if (!response.ok) {
        let errorMessage = "Failed to process audio upload.";
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errData = await response.json();
            if (errData.error === "INSUFFICIENT_CREDITS") {
              setActiveDashboardTab("credits");
              errorMessage = errData.message || "No meeting credits remaining. Purchase credits to continue.";
            } else if (errData.error === "EMPTY_AUDIO" || errData.error === "AUDIO_TOO_SHORT") {
              errorMessage = errData.message || "Recording too short / no audio captured. Check your microphone and try again.";
            } else {
              errorMessage = errData.error || errData.message || errorMessage;
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
      setActiveTab("minutes");

      // Sync credits & billing info if returned
      if (data.meetingCreditsRemaining !== undefined) {
        setMeetingCredits(data.meetingCreditsRemaining);
      }

      if (data.noSpeechDetected || isNoSpeechContent(data.transcript, data.minutes)) {
        showNotification(
          data.creditCharged === false
            ? "No speech detected in the recording. Your credit was not charged. Check your mic and try again."
            : "No speech detected in the recording. Check your microphone and try again.",
          "info"
        );
      }

      // Refresh Firestore lists to get newly added item
      await refreshUserProfile(user);

      // Save to local history list
      const newHistoryItem: MeetingItem = {
        meetingId: `upload_${Date.now()}`,
        title: titleToUse,
        date: new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        duration: "File Upload",
        transcript: data.transcript,
        minutes: data.minutes,
      };

      const updatedHistory = [newHistoryItem, ...history];
      setHistory(updatedHistory);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));

    } catch (error: any) {
      console.error("Direct file upload processing failed:", error);
      notifyOrReloadIfStaleModel(error?.message ?? error, "Upload processing failed");
    } finally {
      setIsProcessing(false);
    }
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

  const parseDurationHours = (duration: string): number => {
    if (!duration || duration === "File Upload") return 1;
    const parts = duration.split(":").map(Number);
    if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
      return parts[0] + parts[1] / 60 + parts[2] / 3600;
    }
    return 1;
  };

  const totalTimeSavedHours = history.length > 0
    ? history.reduce((acc, h) => acc + parseDurationHours(h.duration) * 1.5, 0)
    : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased">
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

      <Toast notification={notification} onDismiss={() => setNotification(null)} />

      {!user ? (
        <div className="min-h-screen flex flex-col">
          <header className="h-16 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/50 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-xl flex items-center justify-center">
                <Mic className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold tracking-tight">
                MinutesFlow <span className="text-indigo-400">AI</span>
              </span>
            </div>
            {authInitialized && (
              <button
                onClick={handleSignIn}
                disabled={authLoading}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
              >
                {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                Sign In
              </button>
            )}
          </header>

          <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-12">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 sm:p-12 text-center relative overflow-hidden shadow-2xl">
            {/* Waveform graphic on background of CTA */}
            <div className="absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none">
              <div className="flex gap-2 items-center">
                <div className="w-1.5 h-16 bg-indigo-500 rounded-full"></div>
                <div className="w-1.5 h-32 bg-indigo-500 rounded-full"></div>
                <div className="w-1.5 h-24 bg-indigo-500 rounded-full"></div>
                <div className="w-1.5 h-40 bg-indigo-500 rounded-full"></div>
                <div className="w-1.5 h-28 bg-indigo-500 rounded-full"></div>
              </div>
            </div>

            <div className="relative z-10 space-y-6">
              <div className="w-16 h-16 bg-indigo-500/10 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-indigo-500/20">
                <Sparkles className="w-8 h-8 animate-pulse" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-light text-slate-100 tracking-tight">
                English Translation &amp; Structured Minutes
              </h2>
              <p className="text-slate-400 text-sm leading-relaxed max-w-md mx-auto">
                Securely stream meetings up to 5 hours. Our {geminiModelLabel} system automatically transcribes,
                translates non-English parts, and organizes expert meeting summaries.
              </p>

              <div className="pt-4 max-w-xs mx-auto">
                <button
                  onClick={handleSignIn}
                  disabled={authLoading}
                  className="w-full flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white py-3.5 px-6 rounded-xl font-semibold shadow-lg shadow-indigo-600/20 transition-all cursor-pointer disabled:opacity-50"
                >
                  {authLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Globe className="w-5 h-5" />
                  )}
                  Sign in with Google
                </button>
                <p className="text-sm text-slate-500 mt-2">
                  Sign in to record meetings and generate structured minutes.
                </p>
                <p className="text-xs text-slate-500 mt-4 text-center leading-relaxed">
                  By signing in, you agree to our{" "}
                  <button
                    type="button"
                    onClick={() => setLegalDocType("privacy")}
                    className="text-slate-400 hover:text-indigo-300 underline underline-offset-2 cursor-pointer transition-colors"
                  >
                    Privacy Policy
                  </button>{" "}
                  and{" "}
                  <button
                    type="button"
                    onClick={() => setLegalDocType("terms")}
                    className="text-slate-400 hover:text-indigo-300 underline underline-offset-2 cursor-pointer transition-colors"
                  >
                    Terms of Service
                  </button>
                  .
                </p>

                {!import.meta.env.PROD && (
                  <>
                    <div className="relative flex py-4 items-center">
                      <div className="flex-grow border-t border-slate-800"></div>
                      <span className="flex-shrink mx-4 text-slate-600 text-[10px] font-bold uppercase font-mono tracking-widest">Or</span>
                      <div className="flex-grow border-t border-slate-800"></div>
                    </div>

                    <button
                      onClick={handleSandboxSignIn}
                      type="button"
                      className="w-full flex items-center justify-center gap-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 py-3 px-6 rounded-xl text-xs font-semibold border border-slate-700/60 hover:border-slate-650 transition-all cursor-pointer shadow-md"
                    >
                      <Sparkles className="w-4 h-4 text-indigo-400" />
                      Explore in Local Sandbox Mode
                    </button>
                    <p className="text-[9px] text-slate-500 mt-2.5 font-mono leading-relaxed">
                      ⚡ Perfect for previewing translation &amp; minutes without configuring Firebase Auth.
                    </p>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setShowTroubleshootModal(true)}
                  className="mt-5 text-[10px] text-indigo-400 hover:text-indigo-300 underline font-mono cursor-pointer block mx-auto"
                >
                  ⚠️ Having Google Sign-In issues? Get Help
                </button>
              </div>
            </div>
            </div>
          </main>

          <footer className="border-t border-slate-800 px-6 py-4 text-center">
            <LegalLinks onOpen={setLegalDocType} />
          </footer>
        </div>
      ) : (
        <DashboardLayout
          activeTab={activeDashboardTab}
          onTabChange={setActiveDashboardTab}
          user={user}
          meetingCredits={meetingCredits}
          onSignOut={handleSignOut}
          getUserInitials={getUserInitials}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          onOpenLegal={setLegalDocType}
        >
          <div className="max-w-6xl mx-auto space-y-6">
            {/* DASHBOARD HOME */}
            {activeDashboardTab === "dashboard" && (
              <div className="space-y-6 animate-[fadeIn_0.3s_ease]">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-100">
                      Welcome back{user.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">
                      Your meeting intelligence dashboard
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveDashboardTab("record")}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
                  >
                    <Mic className="w-5 h-5" />
                    Start Recording
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div
                    onClick={() => setActiveDashboardTab("credits")}
                    className="bg-slate-900 border border-slate-800 hover:border-indigo-500/30 rounded-xl p-6 cursor-pointer transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <CreditCard className="w-8 h-8 text-indigo-400 opacity-60" />
                    </div>
                    <p className="text-sm text-slate-400 mt-4">Available Credits</p>
                    <p className="text-3xl font-bold text-slate-100 mt-1">{meetingCredits}</p>
                  </div>

                  <div
                    onClick={() => setActiveDashboardTab("history")}
                    className="bg-slate-900 border border-slate-800 hover:border-indigo-500/30 rounded-xl p-6 cursor-pointer transition-all"
                  >
                    <History className="w-8 h-8 text-violet-400 opacity-60" />
                    <p className="text-sm text-slate-400 mt-4">Meetings Processed</p>
                    <p className="text-3xl font-bold text-slate-100 mt-1">{history.length}</p>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <FileText className="w-8 h-8 text-indigo-400 opacity-60" />
                    <p className="text-sm text-slate-400 mt-4">Minutes Generated</p>
                    <p className="text-3xl font-bold text-slate-100 mt-1">{minutesGenerated}</p>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <Clock className="w-8 h-8 text-emerald-400 opacity-60" />
                    <p className="text-sm text-slate-400 mt-4">Total Time Saved</p>
                    <p className="text-3xl font-bold text-emerald-400 mt-1">
                      {totalTimeSavedHours.toFixed(1)}<span className="text-lg text-slate-400 font-normal ml-1">hrs</span>
                    </p>
                  </div>
                </div>

                {meetingCredits === 0 && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p className="text-sm text-amber-200">You need credits to process meetings. Purchase credits to get started.</p>
                    <button
                      type="button"
                      onClick={() => setActiveDashboardTab("credits")}
                      className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm font-semibold cursor-pointer shrink-0"
                    >
                      Buy Credits
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* BUY CREDITS */}
            {activeDashboardTab === "credits" && (
              <BuyCreditsSection
                formatPackagePrice={formatPackagePrice}
                creditPriceRm={CREDIT_PRICE_RM}
                checkingOutPlan={checkingOutPlan}
                onCheckout={handleCreditCheckout}
                stripeConfigured={stripeConfigured}
              />
            )}

            {/* RECORD & UPLOAD */}
            {activeDashboardTab === "record" && (
              <div className="space-y-6 w-full">
                <div>
                  <h2 className="text-2xl font-bold text-slate-100">Record &amp; Upload</h2>
                  <p className="text-sm text-slate-400 mt-1">Record live audio or upload a meeting file</p>
                </div>
                {/* Onboarding Quick-Start Guide */}
                {showOnboarding && !import.meta.env.PROD && (
                  <div className="bg-gradient-to-r from-slate-900 via-indigo-950/20 to-slate-900 border border-indigo-500/10 rounded-2xl p-5 shadow-md relative overflow-hidden animate-[fadeIn_0.3s_ease]">
                    <button
                      type="button"
                      onClick={() => {
                        setShowOnboarding(false);
                        localStorage.setItem("minutesflow_hide_onboarding", "true");
                      }}
                      className="absolute top-3.5 right-4 text-slate-500 hover:text-slate-300 transition-all text-xs cursor-pointer font-bold font-mono"
                    >
                      × Dismiss
                    </button>
                    
                    <div className="space-y-1">
                      <span className="inline-flex items-center gap-1 text-[8px] bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-0.5 rounded-full text-indigo-300 font-bold tracking-wider uppercase font-mono">
                        <Sparkles className="w-2.5 h-2.5" /> Launch Checklist
                      </span>
                      <h4 className="text-xs font-bold text-slate-100">SaaS Onboarding Playbook</h4>
                      <p className="text-[11px] text-slate-400 font-sans">Complete these 3 rapid steps to generate executive meeting logs and minutes:</p>
                    </div>

                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-[11px] leading-relaxed">
                      <div className="flex items-start gap-2">
                        <div className={`w-4 h-4 rounded-full ${meetingTitle ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-indigo-500/10 border-indigo-500/20 text-indigo-300"} border flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5 font-mono`}>
                          {meetingTitle ? "✓" : "1"}
                        </div>
                        <div>
                          <strong className="text-slate-200 block font-semibold">Title Meeting</strong>
                          <span className="text-slate-400">Provide an organized identifier for indexing.</span>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <div className={`w-4 h-4 rounded-full ${isRecording ? "bg-amber-500/15 border-amber-500/25 text-amber-400 animate-pulse" : "bg-indigo-500/10 border-indigo-500/20 text-indigo-300"} border flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5 font-mono`}>
                          {isRecording ? "●" : "2"}
                        </div>
                        <div>
                          <strong className="text-slate-200 block font-semibold">Stream Audio</strong>
                          <span className="text-slate-400">Use live mic or drop raw files up to 500MB.</span>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <div className={`w-4 h-4 rounded-full ${history.length > 0 ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-indigo-500/10 border-indigo-500/20 text-indigo-300"} border flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5 font-mono`}>
                          {history.length > 0 ? "✓" : "3"}
                        </div>
                        <div>
                          <strong className="text-slate-200 block font-semibold">Download Result</strong>
                          <span className="text-slate-500">Download minutes or English transcripts as plain text.</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start w-full animate-[fadeIn_0.2s_ease]">
                  {/* LEFT COLUMN: Controls */}
                <div className="lg:col-span-5 space-y-6">
                  {/* Meeting Title input */}
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2 shadow-sm">
                    <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                      Meeting Title / Concept
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Q4 Strategy Session, Product Sync..."
                      value={meetingTitle}
                      onChange={(e) => setMeetingTitle(e.target.value)}
                      disabled={isRecording || isProcessing}
                      className="w-full px-4 py-2.5 text-xs rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all disabled:opacity-50"
                    />
                  </div>

                  {/* Input Method Switcher */}
                  <div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-800 shadow-sm">
                    <button
                      type="button"
                      onClick={() => { setActiveInputMethod("stream"); setDeviceError(null); }}
                      disabled={isRecording || isProcessing}
                      className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 ${
                        activeInputMethod === "stream"
                          ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/15"
                          : "text-slate-400 hover:text-slate-100"
                      }`}
                    >
                      <Mic className="w-3.5 h-3.5" />
                      Live Mic Stream
                    </button>
                    <button
                      type="button"
                      onClick={() => { setActiveInputMethod("upload"); }}
                      disabled={isRecording || isProcessing}
                      className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 ${
                        activeInputMethod === "upload"
                          ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/15"
                          : "text-slate-400 hover:text-slate-100"
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Upload Audio File
                    </button>
                  </div>

                  {/* Microphone notice */}
                  {deviceError && (
                    <div className="bg-rose-500/10 border border-rose-500/20 text-rose-200 text-xs rounded-2xl p-4 flex gap-3 items-start">
                      <AlertCircle className="w-5 h-5 shrink-0 text-rose-400 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold text-rose-300">Microphone Notice</p>
                        <p className="leading-relaxed opacity-90 text-[11px]">{deviceError}</p>
                        <button
                          type="button"
                          onClick={() => setDeviceError(null)}
                          className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 underline mt-1.5 cursor-pointer"
                        >
                          Dismiss Notice
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Input Card Container */}
                  {activeInputMethod === "stream" ? (
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 flex flex-col items-center justify-center relative overflow-hidden shadow-xl">
                      {/* Background wave effect */}
                      {isRecording ? (
                        <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
                          <div className="flex gap-2 items-center">
                            <div className="w-1.5 h-12 bg-rose-400 rounded-full saas-wave-bar" style={{ animationDelay: '0.1s' }}></div>
                            <div className="w-1.5 h-24 bg-indigo-400 rounded-full saas-wave-bar" style={{ animationDelay: '0.3s' }}></div>
                            <div className="w-1.5 h-16 bg-rose-400 rounded-full saas-wave-bar" style={{ animationDelay: '0.5s' }}></div>
                            <div className="w-1.5 h-32 bg-indigo-400 rounded-full saas-wave-bar" style={{ animationDelay: '0.2s' }}></div>
                            <div className="w-1.5 h-20 bg-rose-400 rounded-full saas-wave-bar" style={{ animationDelay: '0.4s' }}></div>
                            <div className="w-1.5 h-28 bg-indigo-400 rounded-full saas-wave-bar" style={{ animationDelay: '0.6s' }}></div>
                            <div className="w-1.5 h-14 bg-rose-400 rounded-full saas-wave-bar" style={{ animationDelay: '0.15s' }}></div>
                          </div>
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none">
                          <div className="flex gap-1.5 items-center">
                            <div className="w-1 h-20 bg-indigo-50 rounded-full"></div>
                            <div className="w-1 h-36 bg-indigo-50 rounded-full"></div>
                            <div className="w-1 h-24 bg-indigo-50 rounded-full"></div>
                            <div className="w-1 h-48 bg-indigo-50 rounded-full"></div>
                            <div className="w-1 h-32 bg-indigo-50 rounded-full"></div>
                          </div>
                        </div>
                      )}

                      <div className="w-full relative z-10 flex flex-col items-center">
                        <div className="w-full text-center mb-8">
                          <span className="px-3.5 py-1 bg-indigo-500/10 text-indigo-400 rounded-full text-xs font-semibold border border-indigo-500/20 uppercase tracking-wider">
                            {isRecording ? "Recording Session" : "Ready to Stream"}
                          </span>
                          <h2 className="text-4xl font-mono font-light text-slate-200 mt-4 tracking-wider">
                            {formatTime(recordingSeconds)}
                          </h2>
                          {meetingCredits === 0 && (
                            <button
                              type="button"
                              onClick={() => setActiveDashboardTab("credits")}
                              className="text-[10px] text-amber-400/90 mt-2 font-mono hover:text-amber-300 underline cursor-pointer"
                            >
                              No credits — Buy credits (RM{CREDIT_PRICE_RM}/credit) to record
                            </button>
                          )}
                        </div>

                        {/* Action record button */}
                        <div className="relative group flex justify-center items-center">
                          <div className={`absolute -inset-4 bg-indigo-500/20 rounded-full blur-xl transition-all duration-300 ${isRecording ? "scale-125 bg-rose-500/15" : "scale-100 group-hover:scale-110"}`}></div>
                          {!isRecording ? (
                            <button
                              type="button"
                              onClick={startRecording}
                              disabled={isProcessing || meetingCredits <= 0}
                              className="relative w-28 h-28 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full flex flex-col items-center justify-center shadow-2xl border-4 border-slate-900 transition-transform active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed animate-[pulse_3s_infinite]"
                            >
                              <Mic className="w-6 h-6 mb-1 text-white" />
                              <span className="text-[10px] font-bold uppercase tracking-wider">Record</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={stopRecording}
                              className="relative w-28 h-28 bg-rose-600 hover:bg-rose-500 text-white rounded-full flex flex-col items-center justify-center shadow-2xl border-4 border-slate-900 transition-transform active:scale-95 cursor-pointer"
                            >
                              <Square className="w-6 h-6 mb-1 text-white fill-white" />
                              <span className="text-[10px] font-bold uppercase tracking-wider">Stop</span>
                            </button>
                          )}
                        </div>

                        <p className="mt-8 text-slate-500 text-xs flex items-center gap-1.5 font-mono">
                          {isRecording ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-2 h-2 bg-rose-500 rounded-full animate-ping"></span>
                              <span className="text-slate-300">Stream: {chunksUploaded} chunks ({formatTime(recordingSeconds)})</span>
                            </span>
                          ) : (
                            <span>5-second continuous memory cache active</span>
                          )}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div
                      onDragEnter={meetingCredits > 0 ? handleDrag : undefined}
                      onDragOver={meetingCredits > 0 ? handleDrag : undefined}
                      onDragLeave={meetingCredits > 0 ? handleDrag : undefined}
                      onDrop={meetingCredits > 0 ? handleDrop : undefined}
                      className={`w-full border-2 border-dashed rounded-3xl p-8 text-center transition-all ${
                        meetingCredits <= 0
                          ? "border-amber-500/30 bg-amber-500/5 cursor-not-allowed opacity-80"
                          : dragActive
                          ? "border-indigo-500 bg-indigo-500/10 shadow-lg scale-[1.01] cursor-pointer"
                          : "border-slate-800 bg-slate-900 hover:border-slate-750 hover:bg-slate-900/80 cursor-pointer"
                      } flex flex-col items-center justify-center space-y-6 min-h-[260px] relative overflow-hidden`}
                      onClick={() => {
                        if (meetingCredits <= 0) {
                          setActiveDashboardTab("credits");
                          return;
                        }
                        document.getElementById("audio-upload-input")?.click();
                      }}
                    >
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={handleFileChange}
                        className="hidden"
                        id="audio-upload-input"
                        disabled={isProcessing || meetingCredits <= 0}
                      />
                      
                      <div className="absolute inset-0 flex items-center justify-center opacity-3 pointer-events-none">
                        <div className="flex gap-2 items-center">
                          <div className="w-1 h-12 bg-indigo-500 rounded-full"></div>
                          <div className="w-1 h-24 bg-indigo-500 rounded-full"></div>
                          <div className="w-1 h-16 bg-indigo-500 rounded-full"></div>
                        </div>
                      </div>

                      <div className="w-14 h-14 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20 flex items-center justify-center">
                        <Upload className="w-6 h-6" />
                      </div>
                      
                      <div className="space-y-1.5 relative z-10">
                        <p className="text-sm font-semibold text-slate-200">
                          Drag &amp; drop meeting recording here
                        </p>
                        <p className="text-[11px] text-slate-500 leading-relaxed font-mono">
                          Supports MP3, WAV, M4A, WebM, and OGG
                        </p>
                        {meetingCredits === 0 ? (
                          <p className="text-[10px] text-amber-400 font-mono">Purchase credits (RM{CREDIT_PRICE_RM}/credit) to upload audio files</p>
                        ) : (
                          <p className="text-[10px] text-indigo-400 font-mono">Up to 500MB uploads supported</p>
                        )}
                      </div>
                      
                      {meetingCredits <= 0 ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveDashboardTab("credits");
                          }}
                          className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold transition-all shadow-md cursor-pointer"
                        >
                          Buy Credits
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isProcessing}
                          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-indigo-600/10 cursor-pointer"
                        >
                          Select Audio File
                        </button>
                      )}
                    </div>
                  )}

                  {/* Pipeline state visualizer */}
                  <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Live Pipeline</h3>
                    <div className="grid grid-cols-4 gap-2 items-center text-center">
                      <div className={`flex flex-col items-center ${isRecording ? "opacity-100 scale-105" : "opacity-40"}`}>
                        <div className={`w-8 h-8 rounded-full ${isRecording ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400"} flex items-center justify-center text-xs font-bold mb-1`}>1</div>
                        <p className="text-[10px] font-semibold text-slate-200">Streaming</p>
                      </div>
                      <div className={`flex flex-col items-center ${isProcessing && processingStatus.includes("assembling") ? "opacity-100 scale-105" : "opacity-40"}`}>
                        <div className={`w-8 h-8 rounded-full ${isProcessing && processingStatus.includes("assembling") ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400"} flex items-center justify-center text-xs font-bold mb-1`}>2</div>
                        <p className="text-[10px] font-semibold text-slate-200">Assemble</p>
                      </div>
                      <div className={`flex flex-col items-center ${isProcessing && processingStatus.includes("Structuring") ? "opacity-100 scale-105" : "opacity-40"}`}>
                        <div className={`w-8 h-8 rounded-full ${isProcessing && processingStatus.includes("Structuring") ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400"} flex items-center justify-center text-xs font-bold mb-1`}>3</div>
                        <p className="text-[10px] font-semibold text-slate-200">AI Write</p>
                      </div>
                      <div className={`flex flex-col items-center ${currentMinutes ? "opacity-100 scale-105" : "opacity-40"}`}>
                        <div className={`w-8 h-8 rounded-full ${currentMinutes ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400"} flex items-center justify-center text-xs font-bold mb-1`}>4</div>
                        <p className="text-[10px] font-semibold text-slate-200">Results</p>
                      </div>
                    </div>
                  </div>

                  {/* Limits and buffering widget */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Cloud buffering</span>
                      <span className="text-[10px] text-indigo-400 font-mono">5.0 Hrs limit</span>
                    </div>
                    <div className="w-full h-1 bg-slate-950 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${Math.min(100, (recordingSeconds / 18000) * 100)}%` }}></div>
                    </div>
                    <p className="mt-2.5 text-[10px] text-slate-500 leading-relaxed font-mono">
                      Bypasses browser limits via chunked fast-writes. Perfect for boardroom reviews.
                    </p>
                  </div>
                </div>

                {/* RIGHT COLUMN: Results container */}
                <div id="results-panel" className="lg:col-span-7 space-y-6">
                  {/* Processing banner */}
                  {isProcessing && (
                    <div className="bg-slate-900 border border-slate-850 rounded-3xl p-10 text-center space-y-4 shadow-xl">
                      <div className="inline-flex items-center justify-center w-12 h-12 bg-slate-950 text-indigo-400 rounded-2xl border border-slate-800">
                        <Loader2 className="w-6 h-6 animate-spin" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-slate-200">Assembling &amp; Processing Meeting</h3>
                        <p className="text-xs text-slate-400 mt-2 max-w-sm mx-auto font-mono leading-relaxed">
                          {processingStatus}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {!currentMinutes && !isProcessing && (
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center space-y-4 shadow-sm">
                      <div className="inline-flex items-center justify-center w-12 h-12 bg-slate-950 text-indigo-400 rounded-2xl border border-slate-800">
                        <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-200">No Active Meeting Document</h3>
                        <p className="text-xs text-slate-400 mt-2 max-w-sm mx-auto leading-relaxed">
                          Start a new recording session or upload an audio file to write professional, structured meeting minutes instantly.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Main Minutes results rendering */}
                  {currentMinutes && !isProcessing && (
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl animate-[fadeIn_0.3s_ease]">
                      <div className="px-6 py-5 border-b border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="space-y-1">
                          <h3 className="text-base font-bold text-slate-100 line-clamp-1">{meetingTitle || "Meeting Minutes"}</h3>
                          <p className="text-xs text-slate-400">Structured by {DISPLAY_GEMINI_MODEL}</p>
                        </div>
                      </div>

                      {/* Sub-tabs for content */}
                      <div className="border-b border-slate-800 bg-slate-950/20 flex flex-col sm:flex-row sm:items-center sm:justify-between px-3">
                        <div className="flex flex-1">
                          <button
                            type="button"
                            onClick={() => setActiveTab("minutes")}
                            className={`py-3.5 px-4 font-semibold text-xs border-b-2 transition-all cursor-pointer ${
                              activeTab === "minutes"
                                ? "border-indigo-500 text-indigo-400 bg-slate-900/40"
                                : "border-transparent text-slate-400 hover:text-slate-100"
                            }`}
                          >
                            Structured Minutes
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveTab("transcript")}
                            className={`py-3.5 px-4 font-semibold text-xs border-b-2 transition-all cursor-pointer ${
                              activeTab === "transcript"
                                ? "border-indigo-500 text-indigo-400 bg-slate-900/40"
                                : "border-transparent text-slate-400 hover:text-slate-100"
                            }`}
                          >
                            Verbatim English Transcript
                          </button>
                        </div>

                        {/* Quick Sharing Action Bar */}
                        <div className="flex items-center gap-2 py-2 sm:py-0 border-t sm:border-t-0 border-slate-800/40 sm:border-transparent">
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
                            className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-indigo-400 bg-slate-950/40 hover:bg-slate-950/80 px-2.5 py-1 rounded-md border border-slate-800 hover:border-indigo-500/20 transition-all font-mono font-bold cursor-pointer"
                          >
                            <span>📋</span>
                            {(activeTab === "minutes" ? copiedMinutes : copiedTranscript) ? "Copied!" : "Copy Raw"}
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
                            className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-indigo-400 bg-slate-950/40 hover:bg-slate-950/80 px-2.5 py-1 rounded-md border border-slate-800 hover:border-indigo-500/20 transition-all font-mono font-bold cursor-pointer"
                          >
                            <FileDown className="w-3.5 h-3.5 shrink-0" />
                            Download
                          </button>
                        </div>
                      </div>

                      <div className="p-6">
                        {activeTab === "minutes" ? (
                          <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed">
                            <MarkdownRenderer content={currentMinutes} />
                          </div>
                        ) : (
                          <div className="text-slate-300 bg-slate-950 border border-slate-850 rounded-xl p-5 font-mono text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-[450px]">
                            {currentTranscript}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

            {/* TAB CONTENT: MEETING HISTORY */}
            {activeDashboardTab === "history" && (
              <div className="space-y-6 animate-[fadeIn_0.2s_ease]">
                <div>
                  <h2 className="text-2xl font-bold text-slate-100">Meeting History</h2>
                  <p className="text-sm text-slate-400 mt-1">{history.length} meeting{history.length !== 1 ? "s" : ""} processed</p>
                </div>

                {history.length === 0 ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center space-y-4">
                    <History className="w-10 h-10 text-indigo-400 mx-auto opacity-60" />
                    <h4 className="text-base font-semibold text-slate-200">No meetings yet</h4>
                    <p className="text-sm text-slate-400">Processed meetings will appear here.</p>
                    <button
                      type="button"
                      onClick={() => setActiveDashboardTab("record")}
                      className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer"
                    >
                      <Mic className="w-4 h-4" />
                      Process Your First Meeting
                    </button>
                  </div>
                ) : (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-950/50 text-sm text-slate-400 border-b border-slate-800">
                            <th className="py-4 px-6 font-semibold">Meeting</th>
                            <th className="py-4 px-6 font-semibold">Date</th>
                            <th className="py-4 px-6 font-semibold">Duration</th>
                            <th className="py-4 px-6 font-semibold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {history.map((item) => (
                            <tr
                              key={item.meetingId}
                              onClick={() => {
                                viewHistoryItem(item);
                                setActiveDashboardTab("record");
                              }}
                              className="hover:bg-slate-800/30 cursor-pointer transition-colors"
                            >
                              <td className="py-4 px-6">
                                <span className="text-sm font-medium text-slate-200">{item.title}</span>
                              </td>
                              <td className="py-4 px-6 text-sm text-slate-400">{item.date}</td>
                              <td className="py-4 px-6 text-sm text-slate-400">{item.duration}</td>
                              <td className="py-4 px-6 text-right">
                                <button
                                  type="button"
                                  onClick={(e) => deleteHistoryItem(item.meetingId, e)}
                                  className={`p-2 rounded-lg transition-all ${
                                    deleteConfirmId === item.meetingId
                                      ? "text-rose-400 bg-rose-500/10 text-sm font-semibold px-3"
                                      : "text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                                  }`}
                                  title={deleteConfirmId === item.meetingId ? "Click again to confirm" : "Delete"}
                                >
                                  {deleteConfirmId === item.meetingId ? "Confirm" : <Trash2 className="w-4 h-4" />}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: PAYMENTS & BILLING */}
            {activeDashboardTab === "payments" && (
              <div className="space-y-6 animate-[fadeIn_0.2s_ease]">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-100">Payments &amp; Billing</h2>
                    <p className="text-sm text-slate-400 mt-1">
                      {meetingCredits} credit{meetingCredits !== 1 ? "s" : ""} available · Pay As You Go
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveDashboardTab("credits")}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold cursor-pointer shrink-0"
                  >
                    Buy More Credits
                  </button>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-slate-300">Invoice History</h3>

                  {paymentsHistory.length === 0 ? (
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-sm text-slate-500">
                      No transactions found for this account.
                    </div>
                  ) : (
                    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-950/50 text-sm text-slate-400 border-b border-slate-800">
                              <th className="py-4 px-6 font-semibold">Transaction / Date</th>
                              <th className="py-4 px-6 font-semibold">Package</th>
                              <th className="py-4 px-6 font-semibold text-right">Amount</th>
                              <th className="py-4 px-6 font-semibold text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800">
                            {paymentsHistory.map((invoice) => (
                              <tr key={invoice.id} className="hover:bg-slate-800/30">
                                <td className="py-4 px-6">
                                  <div className="text-sm font-medium text-slate-300 truncate max-w-[200px]">{invoice.id}</div>
                                  <div className="text-sm text-slate-500 mt-0.5">
                                    {invoice.createdAt
                                      ? new Date(invoice.createdAt._seconds ? invoice.createdAt._seconds * 1000 : invoice.createdAt).toLocaleString()
                                      : "—"}
                                  </div>
                                </td>
                                <td className="py-4 px-6 text-sm text-slate-300">
                                  {invoice.creditsPurchased
                                    ? `${invoice.creditsPurchased} Credit${invoice.creditsPurchased !== 1 ? "s" : ""}`
                                    : invoice.packageId === "credits_1" ? "1 Credit" :
                                   invoice.packageId === "credits_5" ? "5 Credits" :
                                   invoice.packageId === "credits_10" ? "10 Credits" :
                                   invoice.packageId || "Credits"}
                                </td>
                                <td className="py-4 px-6 text-right text-sm font-semibold text-slate-200">
                                  RM {invoice.amount ? (invoice.amount / 100).toFixed(2) : invoice.amountPaid ? (invoice.amountPaid / 100).toFixed(2) : `${CREDIT_PRICE_RM}.00`}
                                </td>
                                <td className="py-4 px-6 text-center">
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    {invoice.status || "Paid"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: ACCOUNT SETTINGS */}
            {activeDashboardTab === "settings" && (
              <div className="max-w-2xl space-y-6 animate-[fadeIn_0.2s_ease]">
                <div>
                  <h2 className="text-2xl font-bold text-slate-100">Account Settings</h2>
                  <p className="text-sm text-slate-400 mt-1">Manage your profile and connections</p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                  <div className="flex items-center gap-4 border-b border-slate-800 pb-6">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt="Avatar"
                        className="w-16 h-16 rounded-full border border-slate-700 object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-indigo-300 text-lg">
                        {getUserInitials()}
                      </div>
                    )}
                    <div className="space-y-1">
                      <h3 className="text-base font-bold text-slate-100">{user.displayName}</h3>
                      <p className="text-sm text-slate-400">{user.email}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-sm font-semibold text-slate-300">Connections</h4>
                    <div className="flex items-center justify-between bg-slate-950/40 p-4 rounded-xl border border-slate-800">
                      <div className="flex items-center gap-3">
                        <Globe className="w-5 h-5 text-indigo-400" />
                        <div>
                          <p className="text-sm font-medium text-slate-200">Google Account</p>
                          <p className="text-sm text-slate-500">Sign-in &amp; authentication</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <span className="w-2 h-2 bg-emerald-500 rounded-full" />
                        Connected
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800">
                      <span className="text-sm text-slate-500 block">Credits Balance</span>
                      <span className="text-lg font-bold text-indigo-400 block mt-1">{meetingCredits}</span>
                    </div>
                    <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800">
                      <span className="text-sm text-slate-500 block">Meetings Processed</span>
                      <span className="text-lg font-bold text-slate-200 block mt-1">{history.length}</span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>

                  <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800 space-y-2">
                    <h4 className="text-sm font-semibold text-slate-300">Legal</h4>
                    <p className="text-sm text-slate-500">
                      Review how we handle meeting data, Google Sign-In, and Stripe payments.
                    </p>
                    <LegalLinks onOpen={setLegalDocType} className="pt-1" />
                  </div>

                  <div className="bg-rose-950/15 border border-rose-500/20 rounded-xl p-5 space-y-3">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h4 className="text-sm font-semibold text-rose-300">Delete Account</h4>
                        <p className="text-sm text-slate-400 leading-relaxed">
                          Permanently delete your account, meeting history, and remaining credits. This cannot be undone.
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={isDeletingAccount}
                        onClick={handleDeleteAccount}
                        className="px-4 py-2.5 bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/20 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer"
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

      {/* GOOGLE SIGN-IN TROUBLESHOOTING MODAL */}
      {showTroubleshootModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-[fadeIn_0.2s_ease]">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl relative p-6 sm:p-8 space-y-6">
            {/* Close button */}
            <button
              type="button"
              onClick={() => setShowTroubleshootModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-800/40 hover:bg-slate-800 p-2 rounded-full transition-all cursor-pointer z-10"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>

            <div className="space-y-2">
              <div className="w-12 h-12 bg-amber-500/10 text-amber-400 rounded-2xl flex items-center justify-center border border-amber-500/20">
                <AlertCircle className="w-6 h-6 text-amber-450 animate-pulse" />
              </div>
              <h3 className="text-lg font-bold text-slate-100">Google Sign-In Help &amp; Options</h3>
              <p className="text-xs text-slate-400">
                Are you having trouble connecting your Google account in the AI Studio preview? Read on.
              </p>
            </div>

            {authErrorMessage && (
              <div className="bg-rose-500/10 border border-rose-500/25 p-3 rounded-xl">
                <p className="text-[10px] font-bold text-rose-400 uppercase tracking-wide mb-1 font-mono">Last Error Message:</p>
                <p className="text-xs text-rose-300 font-mono break-all">{authErrorMessage}</p>
              </div>
            )}

            <div className="space-y-4 text-xs text-slate-300 leading-relaxed font-sans">
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center shrink-0 font-bold font-mono text-[10px]">1</div>
                <div>
                  <strong className="text-slate-200 font-semibold">The Iframe Limitation (Highly Likely)</strong>
                  <p className="text-slate-400 mt-1">
                    Standard Google Sign-In popups are blocked inside nested frames due to security policies.
                  </p>
                  <p className="text-indigo-400 font-semibold mt-1">
                    👉 Click the <strong className="text-indigo-300">"Open in New Tab"</strong> button in the top-right corner of your preview panel to run the app standalone. Popups work perfectly there!
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center shrink-0 font-bold font-mono text-[10px]">2</div>
                <div>
                  <strong className="text-slate-200 font-semibold">Authorized Domains Configuration</strong>
                  <p className="text-slate-400 mt-1">
                    Firebase Auth restricts logins to authorized domains. If deploying custom URLs, add this URL as an authorized domain:
                  </p>
                  <div className="mt-2 p-2 bg-slate-950 rounded-lg border border-slate-850 flex items-center justify-between gap-2 font-mono text-[10px] text-slate-400 truncate">
                    <span>{window.location.origin}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(window.location.origin);
                        showNotification("Domain copied to clipboard!", "success");
                      }}
                      className="px-2 py-1 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded transition-all cursor-pointer text-[9px]"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row gap-3">
              {!import.meta.env.PROD && (
                <button
                  type="button"
                  onClick={handleSandboxSignIn}
                  className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer text-center flex items-center justify-center gap-2 shadow-md shadow-indigo-600/10"
                >
                  <Sparkles className="w-4.5 h-4.5" />
                  Bypass (Run Sandbox Mode)
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowTroubleshootModal(false)}
                className="py-2.5 px-4 bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer text-center"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SIMULATED CHECKOUT OVERLAY (dev only) */}
      {showSimulatedCheckout && !import.meta.env.PROD && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-[fadeIn_0.2s_ease]">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full overflow-hidden shadow-2xl relative">
            <div className="bg-gradient-to-r from-indigo-900/50 to-slate-900 p-6 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-slate-100 font-mono">Secure Sandbox Checkout</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSimulatedCheckout(false)}
                className="text-slate-400 hover:text-white bg-slate-800/40 hover:bg-slate-800 p-1.5 rounded-full transition-all cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-[10px] font-mono justify-center">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span>SECURE SEC REINFORCED ENVIRONMENT</span>
              </div>

              <div className="bg-slate-950/60 border border-slate-850 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Meeting Credits</span>
                  <span className="font-bold text-indigo-400 font-mono">
                    {purchaseQuantity} Credit{purchaseQuantity !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-800 pt-2 mt-2 text-xs">
                  <span className="text-slate-300 font-semibold">Price Payable</span>
                  <span className="font-black text-slate-100 font-mono">
                    {formatPackagePriceDecimal(purchaseQuantity)}
                  </span>
                </div>
              </div>

              {/* Sandbox Card Details Form */}
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 font-mono">
                    Cardholder Name
                  </label>
                  <input
                    type="text"
                    defaultValue={user?.displayName || "John Doe"}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-all font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 font-mono">
                    Card Number
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      defaultValue="4242 •••• •••• 4242"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-10 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <CreditCard className="w-4 h-4 text-slate-500" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 font-mono">
                      Expiry Date
                    </label>
                    <input
                      type="text"
                      defaultValue="12 / 29"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-all font-mono text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 font-mono">
                      CVC / CVV
                    </label>
                    <input
                      type="text"
                      defaultValue="123"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-all font-mono text-center"
                    />
                  </div>
                </div>
              </div>

              {/* simulated checkout click */}
              <button
                type="button"
                disabled={isProcessingSimulatedPayment}
                onClick={() => handleAuthorizeSimulatedPayment(purchaseQuantity)}
                className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/10 cursor-pointer flex items-center justify-center gap-2"
              >
                {isProcessingSimulatedPayment ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Authorizing Sandbox payment...</span>
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4 text-emerald-100" />
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
