import { Check, Loader2, Sparkles } from "lucide-react";

interface BuyCreditsSectionProps {
  formatPackagePrice: (credits: number) => string;
  creditPriceRm: number;
  checkingOutPlan: number | null;
  onCheckout: (credits: number) => void;
  stripeConfigured: boolean;
}

const PACKAGES = [
  { credits: 1, label: "1 Credit", popular: false },
  { credits: 5, label: "5 Credits", popular: true },
  { credits: 10, label: "10 Credits", popular: false },
] as const;

export function BuyCreditsSection({
  formatPackagePrice,
  creditPriceRm,
  checkingOutPlan,
  onCheckout,
  stripeConfigured,
}: BuyCreditsSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Buy Credits</h2>
        <p className="text-sm text-slate-400 mt-2">
          Pay As You Go — purchase credits when you need them. No subscriptions, no recurring fees.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {PACKAGES.map(({ credits, label, popular }) => (
          <div
            key={credits}
            className={`rounded-xl p-6 flex flex-col justify-between relative ${
              popular
                ? "bg-gradient-to-b from-indigo-950/40 to-slate-900 border-2 border-indigo-500/40 shadow-lg shadow-indigo-500/10"
                : "bg-slate-900 border border-slate-800"
            }`}
          >
            {popular && (
              <span className="absolute -top-3 left-4 text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full">
                Most Popular
              </span>
            )}
            <div>
              <h3 className="text-lg font-bold text-slate-100">{label}</h3>
              <p className="text-sm text-slate-400 mt-1">One-time purchase</p>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-100">{formatPackagePrice(credits)}</span>
              </div>
              <ul className="mt-5 space-y-2 text-sm text-slate-400">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>{credits} meeting credit{credits !== 1 ? "s" : ""}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>RM{creditPriceRm} per credit</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>Credits never expire</span>
                </li>
              </ul>
            </div>
            <button
              type="button"
              disabled={checkingOutPlan !== null}
              onClick={() => onCheckout(credits)}
              className={`w-full mt-6 py-3 px-4 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                popular
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white"
              } disabled:opacity-50`}
            >
              {checkingOutPlan === credits ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {checkingOutPlan === credits ? "Processing..." : `Buy ${label}`}
            </button>
          </div>
        ))}
      </div>

      {!stripeConfigured && !import.meta.env.PROD && (
        <p className="text-sm text-indigo-400/80 text-center">
          Payment preview mode — checkout will use a simulated flow in development.
        </p>
      )}
      {!stripeConfigured && import.meta.env.PROD && (
        <p className="text-sm text-amber-400/80 text-center">
          Payment processing is being configured. Please check back shortly.
        </p>
      )}
    </div>
  );
}
