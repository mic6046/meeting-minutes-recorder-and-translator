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
    <div className="space-y-4 sm:space-y-6 w-full animate-[fadeIn_0.2s_ease]">
      {/* Page header — compact on phone so Record CTA stays above the fold */}
      <div className="sm:mb-0">
        <h2 className="text-lg sm:text-3xl font-bold tracking-tight text-slate-900">
          <span className="sm:hidden">Record or Upload</span>
          <span className="hidden sm:inline">Record or Upload a Meeting</span>
        </h2>
        <p className="hidden sm:block mt-1.5 text-base text-slate-500 max-w-2xl leading-relaxed">
          Turn your conversation into accurate transcripts, summaries, decisions and action items.
        </p>
      </div>

      {/* Create Meeting — one short line on mobile */}
      <div className="rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-white px-3 py-2 sm:px-4 sm:py-3.5 shadow-sm">
        <p className="sm:hidden text-xs text-slate-700 leading-snug">
          <span className="font-semibold text-blue-700">Any language</span>
          <span className="text-slate-400 mx-1">·</span>
          auto-detect → English minutes
        </p>
        <div className="hidden sm:block">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-1">
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
      </div>

      {/* Main workspace first on mobile so Record stays above the fold */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-start">
        {/* Record card */}
        <div
          className={`lg:col-span-6 xl:col-span-5 rounded-2xl border shadow-sm overflow-hidden ${
            activeInputMethod === "stream"
              ? "border-blue-500/40 ring-1 ring-blue-500/20"
              : "border-slate-200"
          } bg-[#0b1f3a] text-white`}
        >
          <button
            type="button"
            onClick={() => onInputMethodChange("stream")}
            disabled={isRecording || isProcessing}
            className="w-full text-left px-4 pt-4 pb-2 sm:px-5 sm:pt-5 cursor-pointer disabled:cursor-default"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden>
                  🎙️
                </span>
                <h3 className="text-base font-semibold text-white">Record a Meeting</h3>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-medium text-slate-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden />
                Auto-detect · any language
              </span>
            </div>
            <p className="hidden sm:block text-xs text-slate-300 mt-1">Record live with your microphone.</p>
          </button>

          <div className="px-4 pb-4 sm:px-5 sm:pb-5 space-y-3 sm:space-y-4">
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
                className="w-full min-h-11 px-3.5 rounded-xl bg-white/10 border border-white/15 text-white placeholder:text-slate-400 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
              />
            </div>

            {deviceError && (
              <div className="rounded-xl bg-rose-500/15 border border-rose-400/30 px-3 py-2.5 text-xs text-rose-100">
                <p className="font-semibold">Microphone notice</p>
                <p className="mt-1 opacity-90">{deviceError}</p>
                <button
                  type="button"
                  onClick={onDismissDeviceError}
                  className="mt-1.5 min-h-11 underline text-rose-50 cursor-pointer px-1"
                >
                  Dismiss
                </button>
              </div>
            )}

            <div className="rounded-2xl bg-black/25 border border-white/10 px-3 py-4 sm:px-4 sm:py-6 flex flex-col items-center text-center">
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
              <p className="mt-2 sm:mt-3 text-3xl sm:text-4xl font-mono font-light tracking-wider text-white tabular-nums">
                {timer}
              </p>

              {isRecording && (
                <div className="mt-4 w-full max-w-xs space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-400">
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
                        className="min-h-11 text-xs text-amber-300 underline cursor-pointer px-2"
                      >
                        Need credits (RM{creditPriceRm}) — Buy credits
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onDiscardRecording}
                      disabled={isSavingRecording || isProcessing}
                      className="min-h-11 text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer px-2"
                    >
                      Discard recording
                    </button>
                  </>
                ) : !isRecording ? (
                  <button
                    type="button"
                    onClick={onStartRecording}
                    disabled={isProcessing || isSavingRecording}
                    className="mt-4 sm:mt-6 flex flex-col items-center gap-2.5 cursor-pointer disabled:opacity-50 group"
                    aria-label="Start Recording"
                  >
                    <span className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-blue-600 group-hover:bg-blue-500 text-white flex items-center justify-center shadow-lg shadow-blue-900/40 border-4 border-white/10 transition-transform active:scale-95">
                      <Mic className="w-7 h-7" />
                    </span>
                    <span className="inline-flex items-center justify-center min-h-11 px-6 rounded-xl bg-blue-600 group-hover:bg-blue-500 text-white text-sm font-semibold">
                      Start Recording
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onStopRecording}
                    className="mt-4 sm:mt-6 flex flex-col items-center gap-2.5 cursor-pointer group"
                    aria-label="Stop Recording"
                  >
                    <span className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-rose-600 group-hover:bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-900/40 border-4 border-white/10 transition-transform active:scale-95">
                      <Square className="w-7 h-7 fill-white" />
                    </span>
                    <span className="inline-flex items-center justify-center min-h-11 px-6 rounded-xl bg-rose-600 group-hover:bg-rose-500 text-white text-sm font-semibold">
                      Stop Recording
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Upload card */}
        <div
          className={`lg:col-span-6 xl:col-span-4 rounded-2xl border bg-white shadow-sm overflow-hidden ${
            activeInputMethod === "upload"
              ? "border-blue-500 ring-1 ring-blue-100"
              : "border-slate-200"
          }`}
        >
          <button
            type="button"
            onClick={() => onInputMethodChange("upload")}
            disabled={isRecording || isProcessing}
            className="w-full text-left px-4 pt-4 pb-2 sm:px-5 sm:pt-5 cursor-pointer disabled:cursor-default"
          >
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-semibold text-slate-900">Upload a Meeting File</h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">Upload an existing audio or video recording.</p>
          </button>

          <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <div
              onDragEnter={onDrag}
              onDragOver={onDrag}
              onDragLeave={onDrag}
              onDrop={onDrop}
              onClick={() => {
                if (!isRecording) document.getElementById("audio-upload-input")?.click();
              }}
              className={`mt-2 rounded-2xl border-2 border-dashed min-h-[160px] sm:min-h-[220px] flex flex-col items-center justify-center text-center px-4 py-6 sm:py-8 transition-all cursor-pointer ${
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
              <span className="mt-3 inline-flex items-center justify-center min-h-11 px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold">
                Choose File
              </span>
              <p className="mt-4 text-xs font-medium text-slate-400 tracking-wide">
                MP3 · M4A · WAV · MP4
              </p>
              <p className="mt-1 text-xs text-slate-400">Up to 500MB · Generate uses 1 credit</p>
            </div>
          </div>
        </div>

        {/* Side panel: ready / live status */}
        <div className="lg:col-span-12 xl:col-span-3 space-y-4">
          {!currentMinutes && !isProcessing && !showLivePanel && (
            <div className="hidden xl:block rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-left">
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

        </div>
      </div>

      {/* Progress — after primary actions so mobile keeps Record above the fold */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-5 shadow-sm">
        <div className="flex items-center gap-2 sm:gap-0 overflow-x-auto">
          {steps.map((step, i) => {
            const state = step.done ? "done" : step.active ? "active" : "idle";
            return (
              <React.Fragment key={step.label}>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div
                    className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      state === "done"
                        ? "bg-emerald-500 text-white"
                        : state === "active"
                        ? "bg-blue-600 text-white ring-4 ring-blue-100"
                        : "bg-slate-100 text-slate-400 border border-slate-200"
                    }`}
                  >
                    {state === "done" ? <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : i + 1}
                  </div>
                  <div className="min-w-0 hidden sm:block">
                    <p
                      className={`text-xs sm:text-sm font-semibold truncate ${
                        state === "idle" ? "text-slate-400" : "text-slate-900"
                      }`}
                    >
                      {step.label}
                    </p>
                    <p
                      className={`text-xs ${
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
                  <div className="w-4 sm:w-8 h-px bg-slate-200 mx-1 sm:mx-2 shrink-0" />
                )}
              </React.Fragment>
            );
          })}
        </div>
        {/* Mobile: show active step name only */}
        <p className="sm:hidden mt-2 text-xs text-slate-600">
          {steps.find((s) => s.active)?.label
            ? `${steps.find((s) => s.active)!.label} in progress`
            : steps.every((s) => s.done)
            ? "Minutes ready"
            : "Ready when you start"}
        </p>
        {isProcessing && (
          <p className="mt-2 sm:mt-3 text-sm text-slate-600 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            {processingStatus || "Processing your meeting…"}
          </p>
        )}
      </div>

      {/* Recent meetings */}
      {recentMeetings.length > 0 && (
        <div id="recent-meetings" className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
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
