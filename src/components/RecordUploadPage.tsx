import React from "react";
import {
  Mic,
  Square,
  Upload,
  Loader2,
  Sparkles,
  Save,
  FileText,
  Check,
  History,
} from "lucide-react";

export interface RecentMeetingItem {
  meetingId: string;
  title: string;
  date: string;
  duration: string;
  minutes?: string;
  hasAudio?: boolean;
}

interface PendingRecordingView {
  title: string;
  durationSeconds: number;
  durationLabel: string;
}

interface RecordUploadPageProps {
  meetingTitle: string;
  onMeetingTitleChange: (value: string) => void;
  isRecording: boolean;
  isProcessing: boolean;
  isSavingRecording: boolean;
  recordingSeconds: number;
  micLevel: number;
  micVoiceThreshold: number;
  pendingRecording: PendingRecordingView | null;
  onPendingTitleChange: (title: string) => void;
  activeInputMethod: "stream" | "upload";
  onInputMethodChange: (method: "stream" | "upload") => void;
  dragActive: boolean;
  onDrag: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  deviceError: string | null;
  onDismissDeviceError: () => void;
  hasCredits: boolean;
  creditPriceRm: number;
  onBuyCredits: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onSaveRecording: () => void;
  onGenerateMinutes: () => void;
  onDiscardRecording: () => void;
  processingStatus: string;
  currentMinutes: string | null;
  formatTime: (seconds: number) => string;
  recentMeetings: RecentMeetingItem[];
  onOpenMeeting: (item: RecentMeetingItem) => void;
  onOpenHistory: () => void;
}

function pipelineSteps(opts: {
  isRecording: boolean;
  isProcessing: boolean;
  processingStatus: string;
  pendingRecording: boolean;
  hasMinutes: boolean;
}) {
  const assembling =
    opts.isProcessing &&
    (opts.processingStatus.toLowerCase().includes("assembl") ||
      opts.processingStatus.toLowerCase().includes("upload") ||
      opts.processingStatus.toLowerCase().includes("transcri"));
  const analyzing =
    opts.isProcessing &&
    (opts.processingStatus.toLowerCase().includes("structur") ||
      opts.processingStatus.toLowerCase().includes("generat") ||
      opts.processingStatus.toLowerCase().includes("analy") ||
      opts.processingStatus.toLowerCase().includes("minutes"));

  return [
    {
      label: "Recording",
      active: opts.isRecording,
      done: opts.pendingRecording || opts.hasMinutes || (opts.isProcessing && !opts.isRecording),
    },
    {
      label: "Processing",
      active: assembling && !analyzing,
      done: analyzing || opts.hasMinutes,
    },
    {
      label: "AI Analysis",
      active: analyzing,
      done: opts.hasMinutes,
    },
    {
      label: "Minutes Ready",
      active: false,
      done: opts.hasMinutes,
    },
  ];
}

function statusLabel(item: RecentMeetingItem): { text: string; className: string } {
  if (item.minutes) {
    return { text: "Minutes Ready", className: "text-emerald-600" };
  }
  if (item.hasAudio) {
    return { text: "Recording saved", className: "text-blue-600" };
  }
  return { text: "In progress", className: "text-slate-500" };
}

export function RecordUploadPage({
  meetingTitle,
  onMeetingTitleChange,
  isRecording,
  isProcessing,
  isSavingRecording,
  recordingSeconds,
  micLevel,
  micVoiceThreshold,
  pendingRecording,
  onPendingTitleChange,
  activeInputMethod,
  onInputMethodChange,
  dragActive,
  onDrag,
  onDrop,
  onFileChange,
  deviceError,
  onDismissDeviceError,
  hasCredits,
  creditPriceRm,
  onBuyCredits,
  onStartRecording,
  onStopRecording,
  onSaveRecording,
  onGenerateMinutes,
  onDiscardRecording,
  processingStatus,
  currentMinutes,
  formatTime,
  recentMeetings,
  onOpenMeeting,
  onOpenHistory,
}: RecordUploadPageProps) {
  const steps = pipelineSteps({
    isRecording,
    isProcessing,
    processingStatus,
    pendingRecording: !!pendingRecording,
    hasMinutes: !!currentMinutes,
  });

  const timer = formatTime(pendingRecording?.durationSeconds ?? recordingSeconds);
  const showLivePanel = isRecording || isProcessing || !!pendingRecording;

  return (
    <div className="space-y-5 sm:space-y-6 w-full animate-[fadeIn_0.2s_ease]">
      {/* Page header */}
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Record or Upload a Meeting
        </h2>
        <p className="mt-1.5 text-sm sm:text-base text-slate-500 max-w-2xl leading-relaxed">
          Turn your conversation into accurate transcripts, summaries, decisions and action items.
        </p>
      </div>

      {/* Create Meeting — language clarity banner */}
      <div className="rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-white px-4 py-3.5 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 mb-1">
          Create Meeting
        </p>
        <p className="text-sm text-slate-700 leading-relaxed">
          <span className="font-semibold text-slate-900">You speak:</span> any language (mix freely) · auto-detected
          <span className="mx-1.5 text-slate-300" aria-hidden>
            →
          </span>
          <span className="font-semibold text-slate-900">You get:</span> English minutes
        </p>
        <p className="mt-1.5 text-xs text-slate-500">
          YOU SPEAK → AI TRANSCRIBES → YOU GET · Transcript · Summary · Decisions · Action Items
        </p>
      </div>

      {/* Progress */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-0">
          {steps.map((step, i) => {
            const state = step.done ? "done" : step.active ? "active" : "idle";
            return (
              <React.Fragment key={step.label}>
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      state === "done"
                        ? "bg-emerald-500 text-white"
                        : state === "active"
                        ? "bg-blue-600 text-white ring-4 ring-blue-100"
                        : "bg-slate-100 text-slate-400 border border-slate-200"
                    }`}
                  >
                    {state === "done" ? <Check className="w-4 h-4" /> : i + 1}
                  </div>
                  <div className="min-w-0">
                    <p
                      className={`text-sm font-semibold truncate ${
                        state === "idle" ? "text-slate-400" : "text-slate-900"
                      }`}
                    >
                      {step.label}
                    </p>
                    <p
                      className={`text-[11px] ${
                        state === "done"
                          ? "text-emerald-600"
                          : state === "active"
                          ? "text-blue-600"
                          : "text-slate-400"
                      }`}
                    >
                      {state === "done" ? "Done" : state === "active" ? "In progress" : "Waiting"}
                    </p>
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div className="hidden sm:block w-8 h-px bg-slate-200 mx-2 shrink-0" />
                )}
              </React.Fragment>
            );
          })}
        </div>
        {isProcessing && (
          <p className="mt-3 text-sm text-slate-600 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            {processingStatus || "Processing your meeting…"}
          </p>
        )}
      </div>

      {/* Main workspace: Record | Upload | Side panel */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Record card */}
        <div
          className={`xl:col-span-5 rounded-2xl border shadow-sm overflow-hidden ${
            activeInputMethod === "stream"
              ? "border-blue-500/40 ring-1 ring-blue-500/20"
              : "border-slate-200"
          } bg-[#0b1f3a] text-white`}
        >
          <button
            type="button"
            onClick={() => onInputMethodChange("stream")}
            disabled={isRecording || isProcessing}
            className="w-full text-left px-5 pt-5 pb-2 cursor-pointer disabled:cursor-default"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden>
                  🎙️
                </span>
                <h3 className="text-base font-semibold text-white">Record a Meeting</h3>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden />
                Auto-detect · any language
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1">Record live with your microphone.</p>
          </button>

          <div className="px-5 pb-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Meeting title</label>
              <input
                type="text"
                placeholder="e.g. Q4 Strategy Meeting"
                value={pendingRecording ? pendingRecording.title : meetingTitle}
                onChange={(e) =>
                  pendingRecording
                    ? onPendingTitleChange(e.target.value)
                    : onMeetingTitleChange(e.target.value)
                }
                disabled={isRecording || isProcessing}
                className="w-full min-h-11 px-3.5 rounded-xl bg-white/10 border border-white/15 text-white placeholder:text-slate-400 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
              />
            </div>

            {deviceError && (
              <div className="rounded-xl bg-rose-500/15 border border-rose-400/30 px-3 py-2.5 text-xs text-rose-100">
                <p className="font-semibold">Microphone notice</p>
                <p className="mt-1 opacity-90">{deviceError}</p>
                <button
                  type="button"
                  onClick={onDismissDeviceError}
                  className="mt-1.5 underline text-rose-50 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}

            <div className="rounded-2xl bg-black/25 border border-white/10 px-4 py-6 flex flex-col items-center text-center">
              <p
                className={`text-xs font-semibold tracking-wide ${
                  isRecording
                    ? "text-rose-300"
                    : pendingRecording
                    ? "text-emerald-300"
                    : "text-slate-300"
                }`}
              >
                {isRecording
                  ? "● Recording…"
                  : pendingRecording
                  ? "Recording complete"
                  : "Ready to record"}
              </p>
              <p className="mt-3 text-4xl font-mono font-light tracking-wider text-white tabular-nums">
                {timer}
              </p>

              {isRecording && (
                <div className="mt-4 w-full max-w-xs space-y-1.5">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Audio level</span>
                    <span className={micLevel > micVoiceThreshold ? "text-emerald-300" : "text-amber-300"}>
                      {micLevel > micVoiceThreshold ? "Hearing you" : "Speak a bit louder"}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full transition-[width] duration-75 ${
                        micLevel > micVoiceThreshold ? "bg-emerald-400" : "bg-amber-400"
                      }`}
                      style={{ width: `${Math.max(4, Math.round(micLevel * 100))}%` }}
                    />
                  </div>
                  <div className="flex items-end justify-center gap-1 h-8 mt-2 opacity-80" aria-hidden>
                    {[0.35, 0.7, 0.45, 0.9, 0.55, 0.8, 0.4].map((base, i) => (
                      <div
                        key={i}
                        className="w-1 rounded-full bg-rose-400 saas-wave-bar"
                        style={{
                          height: `${Math.max(20, base * 100 * (0.4 + micLevel))}%`,
                          animationDelay: `${i * 0.08}s`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-col items-center gap-3 w-full">
                {pendingRecording ? (
                  <>
                    <p className="text-sm text-slate-200">
                      Recording complete → <span className="font-semibold text-white">Generate Minutes</span>
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 w-full max-w-sm">
                      <button
                        type="button"
                        onClick={onGenerateMinutes}
                        disabled={isSavingRecording || isProcessing || !hasCredits}
                        className="flex-1 inline-flex items-center justify-center gap-2 min-h-12 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        <Sparkles className="w-4 h-4" />
                        Generate Minutes
                      </button>
                      <button
                        type="button"
                        onClick={onSaveRecording}
                        disabled={isSavingRecording || isProcessing}
                        className="flex-1 inline-flex items-center justify-center gap-2 min-h-12 px-4 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        {isSavingRecording ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        Save (free)
                      </button>
                    </div>
                    {!hasCredits && (
                      <button
                        type="button"
                        onClick={onBuyCredits}
                        className="text-xs text-amber-300 underline cursor-pointer"
                      >
                        Need credits (RM{creditPriceRm}) — Buy credits
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onDiscardRecording}
                      disabled={isSavingRecording || isProcessing}
                      className="text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer"
                    >
                      Discard recording
                    </button>
                  </>
                ) : !isRecording ? (
                  <>
                    <button
                      type="button"
                      onClick={onStartRecording}
                      disabled={isProcessing || isSavingRecording}
                      className="relative w-24 h-24 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex flex-col items-center justify-center shadow-lg shadow-blue-900/40 border-4 border-white/10 transition-transform active:scale-95 cursor-pointer disabled:opacity-50"
                      aria-label="Start Recording"
                    >
                      <Mic className="w-7 h-7" />
                    </button>
                    <button
                      type="button"
                      onClick={onStartRecording}
                      disabled={isProcessing || isSavingRecording}
                      className="inline-flex items-center justify-center min-h-11 px-6 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      Start Recording
                    </button>
                    <p className="text-xs text-slate-400">Your microphone is ready</p>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={onStopRecording}
                      className="relative w-24 h-24 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex flex-col items-center justify-center shadow-lg shadow-rose-900/40 border-4 border-white/10 transition-transform active:scale-95 cursor-pointer"
                      aria-label="Stop Recording"
                    >
                      <Square className="w-7 h-7 fill-white" />
                    </button>
                    <button
                      type="button"
                      onClick={onStopRecording}
                      className="inline-flex items-center justify-center min-h-11 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold cursor-pointer"
                    >
                      Stop Recording
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Upload card */}
        <div
          className={`xl:col-span-4 rounded-2xl border bg-white shadow-sm overflow-hidden ${
            activeInputMethod === "upload"
              ? "border-blue-500 ring-1 ring-blue-100"
              : "border-slate-200"
          }`}
        >
          <button
            type="button"
            onClick={() => onInputMethodChange("upload")}
            disabled={isRecording || isProcessing}
            className="w-full text-left px-5 pt-5 pb-2 cursor-pointer disabled:cursor-default"
          >
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-semibold text-slate-900">Upload a Meeting File</h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">Upload an existing audio or video recording.</p>
          </button>

          <div className="px-5 pb-5">
            <div
              onDragEnter={onDrag}
              onDragOver={onDrag}
              onDragLeave={onDrag}
              onDrop={onDrop}
              onClick={() => {
                if (!isRecording) document.getElementById("audio-upload-input")?.click();
              }}
              className={`mt-2 rounded-2xl border-2 border-dashed min-h-[220px] flex flex-col items-center justify-center text-center px-4 py-8 transition-all cursor-pointer ${
                dragActive
                  ? "border-blue-500 bg-blue-50"
                  : "border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/40"
              } ${isRecording || isProcessing ? "opacity-50 pointer-events-none" : ""}`}
            >
              <input
                type="file"
                accept="audio/*,video/mp4,video/webm,.mp3,.m4a,.wav,.mp4,.webm,.ogg"
                onChange={onFileChange}
                className="hidden"
                id="audio-upload-input"
                disabled={isProcessing || isSavingRecording || isRecording}
              />
              <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center mb-3">
                <Upload className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-900">Drag &amp; drop your file here</p>
              <p className="text-xs text-slate-500 mt-1">or</p>
              <span className="mt-3 inline-flex items-center justify-center min-h-10 px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold">
                Choose File
              </span>
              <p className="mt-4 text-[11px] font-medium text-slate-400 tracking-wide">
                MP3 · M4A · WAV · MP4
              </p>
              <p className="mt-1 text-[11px] text-slate-400">Up to 500MB · Generate uses 1 credit</p>
            </div>
          </div>
        </div>

        {/* Side panel: ready / live status */}
        <div className="xl:col-span-3 space-y-4">
          {!currentMinutes && !isProcessing && !showLivePanel && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-center xl:text-left">
              <div className="w-12 h-12 mx-auto xl:mx-0 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center text-xl">
                🎙️
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900">Ready when you are</h3>
              <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">
                Start a recording or upload a meeting file to generate your meeting minutes.
              </p>
            </div>
          )}

          {showLivePanel && !currentMinutes && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  {isProcessing ? "Processing" : isRecording ? "Live Meeting" : "Recording ready"}
                </h3>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Duration</dt>
                  <dd className="font-medium text-slate-900 tabular-nums">{timer}</dd>
                </div>
                {isRecording && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Audio level</dt>
                    <dd className="font-medium text-slate-900">
                      {micLevel > micVoiceThreshold ? "Active" : "Quiet"}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Status</dt>
                  <dd className="font-medium text-slate-900 text-right max-w-[60%]">
                    {isProcessing
                      ? processingStatus || "Working…"
                      : isRecording
                      ? "Recording"
                      : "Ready to generate"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Language</dt>
                  <dd className="font-medium text-slate-900">Auto-detect · any language</dd>
                </div>
              </dl>
            </div>
          )}

          {(currentMinutes || isProcessing) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:hidden">
              <p className="text-sm text-slate-600">
                {isProcessing
                  ? "Your minutes are being prepared below…"
                  : "Minutes are ready — scroll down to review."}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Recent meetings */}
      {recentMeetings.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-900">Recent Meetings</h3>
            </div>
            <button
              type="button"
              onClick={onOpenHistory}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              View all
            </button>
          </div>
          <ul className="divide-y divide-slate-100">
            {recentMeetings.map((item) => {
              const status = statusLabel(item);
              return (
                <li key={item.meetingId}>
                  <button
                    type="button"
                    onClick={() => onOpenMeeting(item)}
                    className="w-full flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-5 py-3.5 text-left hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <span className="flex-1 min-w-0 text-sm font-semibold text-slate-900 truncate">
                      {item.title || "Untitled meeting"}
                    </span>
                    <span className="text-xs text-slate-500 shrink-0">{item.date}</span>
                    <span className="text-xs text-slate-500 shrink-0 tabular-nums">{item.duration}</span>
                    <span className={`text-xs font-semibold shrink-0 ${status.className}`}>
                      {item.minutes ? "✓ " : ""}
                      {status.text}
                    </span>
                    <span className="text-xs font-semibold text-blue-600 shrink-0">
                      {item.minutes ? "View Minutes" : item.hasAudio ? "Open" : "Open"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
