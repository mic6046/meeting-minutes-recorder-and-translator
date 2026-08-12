import React, { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

interface ScrollDownHintProps {
  targetId: string | null;
  label: string;
}

/** Soft sticky chip that reminds users content exists below the fold. */
export function ScrollDownHint({ targetId, label }: ScrollDownHintProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!targetId) {
      setShow(false);
      return;
    }

    let observer: IntersectionObserver | null = null;
    let cancelled = false;

    const attach = () => {
      const el = document.getElementById(targetId);
      if (!el || cancelled) {
        setShow(false);
        return false;
      }

      observer?.disconnect();
      observer = new IntersectionObserver(
        ([entry]) => {
          setShow(!entry.isIntersecting);
        },
        {
          threshold: 0.12,
          // Treat area covered by mobile bottom nav as off-screen
          rootMargin: "0px 0px -100px 0px",
        }
      );
      observer.observe(el);
      return true;
    };

    if (!attach()) {
      const retry = window.setTimeout(() => {
        attach();
      }, 80);
      return () => {
        cancelled = true;
        window.clearTimeout(retry);
        observer?.disconnect();
      };
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [targetId]);

  if (!targetId || !show || !label) return null;

  return (
    <button
      type="button"
      onClick={() => {
        document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      className="fixed z-30 left-1/2 -translate-x-1/2 bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 inline-flex items-center gap-1.5 max-w-[min(92vw,22rem)] min-h-11 px-3.5 py-2.5 rounded-full bg-slate-900/95 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-slate-900/20 border border-white/10 backdrop-blur-sm hover:bg-slate-800 transition-colors cursor-pointer animate-[fadeIn_0.2s_ease]"
      aria-label={label}
    >
      <span className="truncate">{label}</span>
      <ChevronDown className="w-4 h-4 shrink-0 animate-bounce" aria-hidden />
    </button>
  );
}
