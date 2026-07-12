import { AlertCircle, Check, X } from "lucide-react";

export interface ToastNotification {
  message: string;
  type: "success" | "error" | "info";
}

interface ToastProps {
  notification: ToastNotification | null;
  onDismiss: () => void;
}

export function Toast({ notification, onDismiss }: ToastProps) {
  if (!notification) return null;

  const styles = {
    success: "bg-emerald-950/90 border-emerald-500/30 text-emerald-200",
    error: "bg-rose-950/90 border-rose-500/30 text-rose-200",
    info: "bg-indigo-950/90 border-indigo-500/30 text-indigo-200",
  };

  const Icon = notification.type === "success" ? Check : AlertCircle;

  return (
    <div
      role="alert"
      className={`fixed bottom-20 lg:bottom-6 right-4 z-[100] max-w-sm w-full p-4 rounded-xl border shadow-2xl backdrop-blur-md flex items-start gap-3 animate-[fadeIn_0.3s_ease] ${styles[notification.type]}`}
    >
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <p className="flex-1 text-sm leading-relaxed font-medium">{notification.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="p-1 rounded-lg hover:bg-white/10 transition-colors shrink-0"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
