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
  /** Hide while recording/uploading so actions stay reachable on short screens. */
  suppress?: boolean;
}

/**
 * Helps PC (Chrome/Edge), Android, and iPhone users install MinutesFlow as an app.
 * Delayed so it does not fight first-load CTAs; suppressed on the Record tab.
 */
export function InstallAppPrompt({ suppress = false }: InstallAppPromptProps) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [iosTip, setIosTip] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === "true") return;

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
    <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 left-3 right-3 sm:left-auto sm:right-6 sm:max-w-sm z-[60]">
      <div className="rounded-2xl border border-indigo-500/30 bg-slate-900/95 backdrop-blur-md shadow-2xl p-4 flex gap-3 items-start">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shrink-0">
          <Download className="w-5 h-5 text-indigo-300" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold text-slate-100">Install MinutesFlow</p>
          {iosTip ? (
            <p className="text-xs text-slate-400 leading-relaxed">
              On iPhone: tap <Share className="w-3.5 h-3.5 inline text-indigo-300 align-text-bottom" /> Share, then{" "}
              <span className="text-slate-200">Add to Home Screen</span> for a full-screen app.
            </p>
          ) : (
            <p className="text-xs text-slate-400 leading-relaxed">
              Add to your PC, Android, or tablet home screen for one-tap access and a cleaner full-screen experience.
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            {!iosTip && deferred && (
              <button
                type="button"
                onClick={install}
                className="inline-flex items-center justify-center min-h-10 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
              >
                Install app
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex items-center justify-center min-h-10 px-3 rounded-xl text-slate-400 hover:text-slate-200 text-xs font-medium cursor-pointer"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 cursor-pointer shrink-0"
          aria-label="Dismiss install tip"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
