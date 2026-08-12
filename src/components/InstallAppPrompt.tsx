import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

const DISMISS_KEY = "minutesflow_install_prompt_dismissed";
const SHOW_DELAY_MS = 8000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return true;
  const mq = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mq || iosStandalone;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

interface InstallAppPromptProps {
  suppress?: boolean;
  /** When true, sit above the mobile bottom nav */
  hasBottomNav?: boolean;
}

export function InstallAppPrompt({ suppress = false, hasBottomNav = false }: InstallAppPromptProps) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [iosTip, setIosTip] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === "true") return;

    // Delay so Sign-in / Record CTAs stay clear on first paint
    const delay = window.setTimeout(() => setReady(true), SHOW_DELAY_MS);

    if (isIos()) {
      setIosTip(true);
      return () => window.clearTimeout(delay);
    }

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => {
      window.clearTimeout(delay);
      window.removeEventListener("beforeinstallprompt", onBip);
    };
  }, []);

  useEffect(() => {
    if (!ready || suppress) {
      setVisible(false);
      return;
    }
    if (iosTip || deferred) {
      setVisible(true);
    }
  }, [ready, suppress, iosTip, deferred]);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* user dismissed native prompt */
    }
    setDeferred(null);
    dismiss();
  };

  if (!visible || suppress) return null;

  return (
    <div
      className={`fixed left-3 right-3 sm:left-auto sm:right-6 sm:max-w-sm z-[60] ${
        hasBottomNav
          ? "bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-6"
          : "bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]"
      }`}
    >
      <div className="mf-card p-4 flex gap-3 items-start shadow-lg">
        <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
          <Download className="w-5 h-5 text-blue-600" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold text-slate-900">Install MinutesFlow</p>
          {iosTip ? (
            <p className="text-xs text-slate-500 leading-relaxed">
              On iPhone: tap <Share className="w-3.5 h-3.5 inline text-blue-600 align-text-bottom" /> Share, then{" "}
              <span className="text-slate-800 font-medium">Add to Home Screen</span>.
            </p>
          ) : (
            <p className="text-xs text-slate-500 leading-relaxed">
              Install on PC, Android, or tablet for one-tap access.
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            {!iosTip && deferred && (
              <button type="button" onClick={install} className="mf-btn mf-btn-primary min-h-11 px-3 text-xs">
                Install app
              </button>
            )}
            <button type="button" onClick={dismiss} className="mf-btn mf-btn-ghost min-h-11 px-3 text-xs">
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
          aria-label="Dismiss install tip"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
