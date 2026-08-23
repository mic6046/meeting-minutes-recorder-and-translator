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
              <p className="text-xs text-slate-500">How to use MinutesFlow · Updated Aug 2026</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 space-y-6">
          <Section title="1. What MinutesFlow does">
            <p>
              MinutesFlow turns a spoken meeting into{" "}
              <span className="text-slate-800 font-medium">Structured Minutes</span> (summary,
              decisions, action items) and a{" "}
              <span className="text-slate-800 font-medium">Verbatim English Transcript</span>.
            </p>
            <p>
              Speak <span className="text-slate-800 font-medium">any language</span>—or mix
              several in one meeting. Language is{" "}
              <span className="text-slate-800 font-medium">auto-detected</span>. You get{" "}
              <span className="text-slate-800 font-medium">English minutes</span>.
            </p>
            <p>
              You can copy, download as <span className="text-slate-800 font-medium">.txt</span>,
              or read aloud. Always review AI output before sharing or acting on it.
            </p>
          </Section>

          <Section title="2. Sign in">
            <ol className="list-decimal pl-5 space-y-1">
              <li>
                Open the app and tap{" "}
                <span className="text-slate-800 font-medium">Sign in with Google</span>.
              </li>
              <li>Choose your Google account.</li>
            </ol>
            <p>
              Guest login is not available. One Google email = one account. Sign in on PC,
              Android, or iPhone with the same account to keep credits and history in sync.
            </p>
          </Section>

          <Section title="3. Main screens">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="text-slate-800 font-medium">Dashboard</span> — greeting, credits
                warning, quick stats, Start Recording
              </li>
              <li>
                <span className="text-slate-800 font-medium">Record &amp; Upload</span> — live
                microphone recording or file upload
              </li>
              <li>
                <span className="text-slate-800 font-medium">Meeting History</span> — past
                meetings, generate/redo, audio download, delete
              </li>
              <li>
                <span className="text-slate-800 font-medium">Buy Credits</span> — one-time credit
                packages (Stripe)
              </li>
              <li>
                <span className="text-slate-800 font-medium">Payments &amp; Billing</span> —
                purchase history
              </li>
              <li>
                <span className="text-slate-800 font-medium">Account Settings</span> — profile,
                manual, legal, delete account
              </li>
            </ul>
          </Section>

          <Section title="4. Credits &amp; pricing">
            <p>
              <span className="text-slate-800 font-medium">1 credit</span> is used when you tap{" "}
              <span className="text-slate-800 font-medium">Generate Minutes</span>. Credits do
              not expire. No subscription.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                1 credit — <span className="text-slate-800 font-medium">RM29</span>
              </li>
              <li>
                5 credits — <span className="text-slate-800 font-medium">RM101.50</span>{" "}
                <span className="text-emerald-600">(save 30%)</span>
              </li>
              <li>
                10 credits — <span className="text-slate-800 font-medium">RM174</span>{" "}
                <span className="text-emerald-600">(save 40%)</span>
              </li>
            </ul>
            <p>
              After the first paid Generate for a meeting,{" "}
              <span className="text-slate-800 font-medium">Redo is free for 24 hours</span> for
              that meeting.
            </p>
            <p>
              Buy credits from <span className="text-slate-800 font-medium">Buy Credits</span>{" "}
              and complete Stripe checkout. If credits do not appear after payment, wait up to a
              minute and refresh, or reopen the app.
            </p>
          </Section>

          <Section title="5. Record a meeting">
            <ol className="list-decimal pl-5 space-y-1">
              <li>
                Open <span className="text-slate-800 font-medium">Record &amp; Upload</span>.
              </li>
              <li>(Optional) Enter a meeting title.</li>
              <li>
                Tap <span className="text-slate-800 font-medium">Start Recording</span> and allow
                the microphone.
              </li>
              <li>
                Keep the browser tab open while recording. Speak clearly; mix languages if
                needed.
              </li>
              <li>
                Tap <span className="text-slate-800 font-medium">Stop Recording</span> when
                finished.
              </li>
              <li>
                Choose <span className="text-slate-800 font-medium">Generate Minutes</span> (1
                credit) or <span className="text-slate-800 font-medium">Save (free)</span> to
                generate later from History.
              </li>
            </ol>
            <p>
              Only record meetings you are authorized to capture. Inform participants when
              required by law or your organization.
            </p>
          </Section>

          <Section title="6. Upload a meeting file">
            <p>
              On <span className="text-slate-800 font-medium">Record &amp; Upload</span>, use the
              upload card. Drag and drop or choose a file (
              <span className="text-slate-800 font-medium">MP3 · M4A · WAV · MP4</span>, up to
              about 500 MB). Then generate minutes (1 credit) or save for later.
            </p>
          </Section>

          <Section title="7. Generate, copy &amp; download">
            <ol className="list-decimal pl-5 space-y-1">
              <li>Confirm you have at least 1 credit.</li>
              <li>
                Tap <span className="text-slate-800 font-medium">Generate Minutes</span> and
                wait for Processing → AI Analysis → Minutes Ready.
              </li>
              <li>
                Review <span className="text-slate-800 font-medium">Minutes</span> and{" "}
                <span className="text-slate-800 font-medium">Transcript</span>.
              </li>
              <li>
                Use <span className="text-slate-800 font-medium">Copy</span>,{" "}
                <span className="text-slate-800 font-medium">Download</span> (.txt), or{" "}
                <span className="text-slate-800 font-medium">Read aloud</span>.
              </li>
            </ol>
            <p>
              If no speech is detected, your credit is not charged. Check the microphone and try
              again.
            </p>
          </Section>

          <Section title="8. Meeting History">
            <p>
              Open past meetings, generate or redo minutes, download the recording while it is
              still stored, or delete meetings. Recordings are kept for up to about{" "}
              <span className="text-slate-800 font-medium">90 days</span> — download important
              audio early. Minutes text stays until you delete it.
            </p>
          </Section>

          <Section title="9. Devices &amp; install">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Works in the browser on <span className="text-slate-800 font-medium">PC</span>,{" "}
                <span className="text-slate-800 font-medium">Android</span>, and{" "}
                <span className="text-slate-800 font-medium">iPhone</span>.
              </li>
              <li>
                You can install MinutesFlow as an app (PWA) from the browser for quicker access.
              </li>
              <li>
                Credits and history sync across devices when you use the same Google account.
                Reopen or focus the app to refresh.
              </li>
            </ul>
          </Section>

          <Section title="10. Important disclaimers">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                AI transcripts and minutes may contain errors, omissions, or imperfect
                language detection/translation.
              </li>
              <li>
                MinutesFlow is a productivity aid—not legal, medical, financial, or compliance
                advice. Review outputs before relying on them.
              </li>
              <li>
                Audio is processed by Google Gemini AI to produce your results. Do not upload
                content your organization forbids sending to third-party AI.
              </li>
              <li>
                You are responsible for having permission to record and process the meeting.
              </li>
            </ul>
          </Section>

          <Section title="11. Quick checklist">
            <ol className="list-decimal pl-5 space-y-1">
              <li>Sign in with Google</li>
              <li>Buy credits if balance is 0</li>
              <li>Record or upload (any language / mix OK)</li>
              <li>Generate Minutes (1 credit) or Save free</li>
              <li>Review → Copy / Download .txt</li>
              <li>Optional: Redo within 24 hours (free)</li>
            </ol>
          </Section>

          <Section title="12. Troubleshooting">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <span className="text-slate-800 font-medium">Sign-in fails</span> — use
                Chrome/Edge/Safari; allow pop-ups; open the official site URL.
              </li>
              <li>
                <span className="text-slate-800 font-medium">No microphone</span> — allow
                Microphone for this site in browser settings.
              </li>
              <li>
                <span className="text-slate-800 font-medium">Quiet audio / no speech</span> —
                move closer to the mic; check the audio-level meter while recording.
              </li>
              <li>
                <span className="text-slate-800 font-medium">Paid but no credits</span> —
                refresh, wait up to a minute, or switch tabs and return so the app re-syncs.
              </li>
              <li>
                <span className="text-slate-800 font-medium">History missing on another
                device</span> — sign in with the same Google account and open the app again.
              </li>
              <li>
                <span className="text-slate-800 font-medium">Cannot find download on phone</span>{" "}
                — check Files/Downloads, or use Copy.
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
              . Full Privacy Policy and Terms of Service are available from Account Settings
              and the login screen.
            </p>
          </Section>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 shrink-0">
          <button type="button" onClick={onClose} className="mf-btn mf-btn-primary w-full">
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
      className={`text-xs text-slate-500 hover:text-blue-600 underline underline-offset-2 cursor-pointer ${className}`}
    >
      Operation Manual
    </button>
  );
}
