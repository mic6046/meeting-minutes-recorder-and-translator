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
    success: "bg-white border-emerald-200 text-emerald-800",
    error: "bg-white border-rose-200 text-rose-800",
    info: "bg-white border-blue-200 text-blue-800",
  };

  const Icon = notification.type === "success" ? Check : AlertCircle;

  return (
    <div
      role="alert"
      className={`fixed z-[100] left-3 right-3 sm:left-auto sm:right-4 sm:max-w-sm bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 p-4 rounded-xl border shadow-lg flex items-start gap-3 animate-[fadeIn_0.3s_ease] ${styles[notification.type]}`}
    >
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <p className="flex-1 text-sm leading-relaxed font-medium">{notification.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
