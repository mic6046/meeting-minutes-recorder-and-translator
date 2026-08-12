import React from "react";
import { BookOpen, X } from "lucide-react";
import { SUPPORT_EMAIL } from "./LegalModal";

interface OperationManualModalProps {
  onClose: () => void;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      <div className="text-slate-600 leading-relaxed space-y-2 text-sm">{children}</div>
    </section>
  );
}

export function OperationManualModal({ onClose }: OperationManualModalProps) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm cursor-pointer"
        aria-label="Close manual"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="operation-manual-title"
        className="relative w-full sm:max-w-2xl max-h-[90vh] bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
              <BookOpen className="w-4 h-4 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h3 id="operation-manual-title" className="text-base font-bold text-slate-900 truncate">
                Operation Manual
              </h3>
              <p className="text-xs text-slate-500">How to use MinutesFlow</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 min-w-10 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 space-y-6">
          <Section title="1. What MinutesFlow does">
            <p>
              MinutesFlow turns a spoken meeting into <span className="text-slate-800 font-medium">Structured Minutes</span>{" "}
              (summary, points, decisions, actions) and a{" "}
              <span className="text-slate-800 font-medium">Verbatim English Transcript</span>. You can copy, download as{" "}
              <span className="text-slate-800 font-medium">.txt</span>, or read aloud.
            </p>
          </Section>

          <Section title="2. Sign in">
            <ol className="list-decimal pl-5 space-y-1">
              <li>Open the app and tap <span className="text-slate-800 font-medium">Sign in with Google</span>.</li>
              <li>Choose your Google account.</li>
            </ol>
            <p>Guest login is not available. One Google email = one account.</p>
          </Section>

          <Section title="3. Main screens">
            <ul className="list-disc pl-5 space-y-1">
              <li><span className="text-slate-800 font-medium">Home</span> — overview</li>
              <li><span className="text-slate-800 font-medium">New Meeting</span> — live record or upload audio</li>
              <li><span className="text-slate-800 font-medium">History</span> — past meetings, redo, downloads</li>
              <li><span className="text-slate-800 font-medium">Credits</span> — buy meeting credits</li>
              <li><span className="text-slate-800 font-medium">Settings</span> — account, legal, delete account</li>
            </ul>
          </Section>

          <Section title="4. Credits &amp; pricing">
            <p>
              <span className="text-slate-800 font-medium">1 credit</span> is used when you tap{" "}
              <span className="text-slate-800 font-medium">Generate Minutes</span>. Credits do not expire. No subscription.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>1 credit — <span className="text-slate-800 font-medium">RM29</span></li>
              <li>5 credits — <span className="text-slate-800 font-medium">RM101.50</span> <span className="text-emerald-600">(save 30%)</span></li>
              <li>10 credits — <span className="text-slate-800 font-medium">RM174</span> <span className="text-emerald-600">(save 40%)</span></li>
            </ul>
            <p>
              After the first paid Generate, <span className="text-slate-800 font-medium">Redo is free for 24 hours</span>{" "}
              for that meeting.
            </p>
            <p>
              Buy credits from the <span className="text-slate-800 font-medium">Credits</span> tab and complete Stripe
              checkout.
            </p>
          </Section>

          <Section title="5. Record a meeting">
            <ol className="list-decimal pl-5 space-y-1">
              <li>Open <span className="text-slate-800 font-medium">Record</span>.</li>
              <li>(Optional) Enter a meeting title.</li>
              <li>Tap <span className="text-slate-800 font-medium">Start Recording</span> and allow the microphone.</li>
              <li>Keep the browser tab open. Cloud buffering supports up to about 5 hours.</li>
              <li>Tap <span className="text-slate-800 font-medium">Stop</span> when finished.</li>
            </ol>
            <p>
              Saving a recording does <span className="text-slate-800 font-medium">not</span> use a credit. Generating
              minutes does.
            </p>
          </Section>

          <Section title="6. Upload audio">
            <p>
              On <span className="text-slate-800 font-medium">Record</span>, choose upload and select an audio file (max
              about 500 MB). Then tap <span className="text-slate-800 font-medium">Generate Minutes</span>.
            </p>
          </Section>

          <Section title="7. Generate, copy &amp; download">
            <ol className="list-decimal pl-5 space-y-1">
              <li>Confirm you have at least 1 credit.</li>
              <li>Tap <span className="text-slate-800 font-medium">Generate Minutes</span> and wait.</li>
              <li>Review <span className="text-slate-800 font-medium">Structured Minutes</span> and{" "}
                <span className="text-slate-800 font-medium">Verbatim English Transcript</span>.</li>
              <li>Use <span className="text-slate-800 font-medium">Copy Raw</span>,{" "}
                <span className="text-slate-800 font-medium">Download</span> (.txt), or{" "}
                <span className="text-slate-800 font-medium">Read aloud</span>.</li>
            </ol>
          </Section>

          <Section title="8. History">
            <p>
              Open past meetings, redo generation (free within 24 hours after first paid Generate), download
              the recording while it is still stored, or delete meetings. Recordings are kept for up to about{" "}
              <span className="text-slate-800 font-medium">90 days</span> — download important results early.
            </p>
          </Section>

          <Section title="9. Quick checklist">
            <ol className="list-decimal pl-5 space-y-1">
              <li>Sign in with Google</li>
              <li>Buy credits if balance is 0</li>
              <li>Record or upload</li>
              <li>Generate Minutes (1 credit)</li>
              <li>Copy / Download .txt</li>
              <li>Optional: Redo within 24 hours (free)</li>
            </ol>
          </Section>

          <Section title="10. Troubleshooting">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <span className="text-slate-800 font-medium">Sign-in fails</span> — use Chrome/Edge; allow pop-ups; open
                the official site URL.
              </li>
              <li>
                <span className="text-slate-800 font-medium">No microphone</span> — allow Microphone for this site in
                browser settings.
              </li>
              <li>
                <span className="text-slate-800 font-medium">Paid but no credits</span> — refresh and wait up to a minute.
              </li>
              <li>
                <span className="text-slate-800 font-medium">Cannot find download on phone</span> — check Files/Downloads,
                or use Copy Raw.
              </li>
            </ul>
          </Section>

          <Section title="Need help?">
            <p>
              Contact{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-blue-600 hover:text-blue-700 underline underline-offset-2"
              >
                {SUPPORT_EMAIL}
              </a>
              . Full Privacy Policy and Terms are available from Settings and the login screen.
            </p>
          </Section>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="mf-btn mf-btn-primary w-full"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Compact help link for footers and settings. */
export function ManualLink({
  onOpen,
  className = "",
}: {
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 transition-colors cursor-pointer ${className}`}
    >
      <BookOpen className="w-3.5 h-3.5" />
      Operation Manual
    </button>
  );
}
