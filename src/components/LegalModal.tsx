import React from "react";
import { Shield, FileText, X } from "lucide-react";

/** Edit this when you have a real support inbox. */
export const SUPPORT_EMAIL = "support@minutesflow.com";

export type LegalDocType = "privacy" | "terms";

interface LegalModalProps {
  type: LegalDocType;
  onClose: () => void;
}

const LAST_UPDATED = "July 16, 2026";

function PrivacyContent() {
  return (
    <>
      <p className="text-slate-400 leading-relaxed">
        MinutesFlow AI (&quot;we&quot;, &quot;our&quot;, or &quot;the Service&quot;) helps you record meeting
        audio, generate AI transcription and structured meeting minutes, and manage
        meeting credits. This Privacy Policy explains what we collect and how we use it.
      </p>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">Information we collect</h4>
        <ul className="list-disc pl-5 space-y-1.5 text-slate-400">
          <li>
            <span className="text-slate-300">Account data</span> — When you sign in with
            Google, we receive your Google account identifier, name, email address, and
            profile photo (if available).
          </li>
          <li>
            <span className="text-slate-300">Meeting content</span> — Audio you record or
            upload, plus AI-generated transcripts and meeting minutes. Audio recordings are
            stored under your account in cloud storage (typically under a path tied to your
            user ID). Transcripts and minutes are stored with your meeting history in
            Firestore.
          </li>
          <li>
            <span className="text-slate-300">Billing data</span> — Purchase records for
            meeting credits processed via Stripe (for example session IDs, amounts, and
            credit quantities). We do not store full card numbers; Stripe handles payment
            card details.
          </li>
          <li>
            <span className="text-slate-300">Usage data</span> — Credit balances and basic
            service logs needed to operate and secure the app.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">How we use information</h4>
        <ul className="list-disc pl-5 space-y-1.5 text-slate-400">
          <li>Authenticate you and maintain your session via Firebase Authentication.</li>
          <li>
            Transcribe and translate meeting audio and produce structured minutes using
            Google Gemini AI.
          </li>
          <li>Store and display your meeting history in Firestore for your account.</li>
          <li>Process credit purchases and fulfill paid usage through Stripe.</li>
          <li>Provide support, prevent abuse, and improve reliability of the Service.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">Third-party services</h4>
        <p className="text-slate-400 leading-relaxed">
          We use Google (Sign-In, Firebase Auth, Firestore, Cloud Storage, Gemini) and Stripe
          (payments). Those providers process data under their own privacy policies.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">
          Recordings, AI processing &amp; access
        </h4>
        <p className="text-slate-400 leading-relaxed">
          When you record or upload a meeting, the audio is stored securely under your
          account and is sent to Google Gemini AI solely to generate transcripts and meeting
          minutes for you. Meeting content is therefore processed by Google&apos;s AI
          services—not only on MinutesFlow servers. The Service operator (the Firebase /
          Google Cloud project owner) can access stored recordings and minutes as needed to
          run and support the Service. You can delete selected meetings or clear history from
          the app; archived audio is also subject to automatic retention limits (currently
          about 90 days for recordings). Please only upload meetings you are authorized to
          process, and avoid highly confidential content if your organization prohibits
          third-party AI processing.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">What we do not do</h4>
        <ul className="list-disc pl-5 space-y-1.5 text-slate-400">
          <li>We do not sell your personal data.</li>
          <li>
            We do not export your meetings to Google Docs or other third-party document
            products as part of the Service.
          </li>
          <li>We do not use your meeting content for advertising.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">Retention &amp; deletion</h4>
        <p className="text-slate-400 leading-relaxed">
          Meeting history and account data are kept while your account is active. Saved
          audio recordings may be removed automatically after our retention period (about 90
          days), while minutes text may remain in your history until you delete it. You can
          delete individual meetings, clear selected/all history, or delete your account from
          Account Settings, which removes associated profile data, meeting history, and
          remaining credits from our systems (subject to backups and legal retention where
          required). Payment records may be retained as needed for accounting and fraud
          prevention.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">Security</h4>
        <p className="text-slate-400 leading-relaxed">
          Access to your data requires authentication. We use industry-standard transport
          encryption (HTTPS) and cloud provider controls. No method of transmission or
          storage is completely secure; please only upload meetings you are authorized to
          process.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">Contact</h4>
        <p className="text-slate-400 leading-relaxed">
          Questions about this policy:{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-indigo-400 hover:text-indigo-300 underline"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <p className="text-slate-400 leading-relaxed">
        These Terms of Service govern your use of MinutesFlow AI. By signing in or using
        the Service, you agree to these terms.
      </p>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">The Service</h4>
        <p className="text-slate-400 leading-relaxed">
          MinutesFlow AI lets you record or upload meeting audio, obtain AI-generated
          English transcription and structured meeting minutes (via Google Gemini), store
          meeting history in your account, and purchase meeting credits through Stripe.
          Features may change as we improve the product.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">Accounts</h4>
        <p className="text-slate-400 leading-relaxed">
          You must sign in with a Google account you control. You are responsible for
          activity under your account and for keeping access to that Google account secure.
          You may delete your account at any time from Account Settings.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">Credits &amp; payments</h4>
        <ul className="list-disc pl-5 space-y-1.5 text-slate-400">
          <li>
            Processing a meeting (recording or upload that results in transcription /
            minutes) consumes meeting credits as shown in the app.
          </li>
          <li>
            Credits are sold in packages via Stripe checkout. Prices are displayed before
            purchase (currently in MYR where applicable).
          </li>
          <li>
            Credits are non-transferable. Refunds are handled case-by-case; contact
            support if a payment failed or credits were not applied after a successful
            charge.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">Acceptable use</h4>
        <p className="text-slate-400 leading-relaxed">
          You may only upload or record content you have the right to process. Do not use
          the Service for unlawful surveillance, harassment, or to upload content that
          infringes others&apos; rights. We may suspend accounts that abuse the Service or
          violate these terms.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">AI output disclaimer</h4>
        <p className="text-slate-400 leading-relaxed">
          Transcripts and minutes are generated by AI and may contain errors, omissions, or
          inaccurate speaker attribution. You are responsible for reviewing outputs before
          relying on them for business, legal, or compliance decisions.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">Intellectual property</h4>
        <p className="text-slate-400 leading-relaxed">
          You retain rights to your meeting content. By using the Service, you grant us a
          limited license to process that content solely to provide transcription, minutes,
          storage, and related features. The MinutesFlow AI product, branding, and software
          remain our property (or our licensors&apos;).
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">Limitation of liability</h4>
        <p className="text-slate-400 leading-relaxed">
          The Service is provided &quot;as is&quot; without warranties of uninterrupted or
          error-free operation. To the fullest extent permitted by law, we are not liable
          for indirect, incidental, or consequential damages arising from use of the
          Service, including decisions made based on AI-generated minutes.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">Changes</h4>
        <p className="text-slate-400 leading-relaxed">
          We may update these terms from time to time. Continued use after changes are
          posted in the app constitutes acceptance of the updated terms.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-200">Contact</h4>
        <p className="text-slate-400 leading-relaxed">
          Questions about these terms:{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-indigo-400 hover:text-indigo-300 underline"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </>
  );
}

export function LegalModal({ type, onClose }: LegalModalProps) {
  const isPrivacy = type === "privacy";
  const title = isPrivacy ? "Privacy Policy" : "Terms of Service";
  const Icon = isPrivacy ? Shield : FileText;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-[fadeIn_0.2s_ease]">
      <div
        className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full max-h-[85vh] overflow-hidden shadow-2xl relative flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-modal-title"
      >
        <div className="p-6 sm:p-8 pb-4 border-b border-slate-800 shrink-0 relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-800/40 hover:bg-slate-800 p-2 rounded-full transition-all cursor-pointer z-10"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="space-y-2 pr-10">
            <div className="w-12 h-12 bg-indigo-500/10 text-indigo-400 rounded-2xl flex items-center justify-center border border-indigo-500/20">
              <Icon className="w-6 h-6" />
            </div>
            <h3 id="legal-modal-title" className="text-lg font-bold text-slate-100">
              {title}
            </h3>
            <p className="text-xs text-slate-500">Last updated: {LAST_UPDATED}</p>
          </div>
        </div>

        <div className="px-6 sm:px-8 py-5 overflow-y-auto space-y-5 text-sm flex-1">
          {isPrivacy ? <PrivacyContent /> : <TermsContent />}
        </div>

        <div className="p-6 sm:p-8 pt-4 border-t border-slate-800 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Compact Privacy / Terms link row for login and footers. */
export function LegalLinks({
  onOpen,
  className = "",
}: {
  onOpen: (type: LegalDocType) => void;
  className?: string;
}) {
  return (
    <p className={`text-xs text-slate-500 ${className}`}>
      <button
        type="button"
        onClick={() => onOpen("privacy")}
        className="text-slate-400 hover:text-indigo-300 underline underline-offset-2 cursor-pointer transition-colors"
      >
        Privacy Policy
      </button>
      <span className="mx-2 text-slate-600">·</span>
      <button
        type="button"
        onClick={() => onOpen("terms")}
        className="text-slate-400 hover:text-indigo-300 underline underline-offset-2 cursor-pointer transition-colors"
      >
        Terms of Service
      </button>
    </p>
  );
}
