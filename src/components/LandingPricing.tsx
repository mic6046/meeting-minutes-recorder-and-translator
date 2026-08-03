import { Check, CreditCard, Loader2, Zap } from "lucide-react";

interface LandingPricingProps {
  onGetStarted: () => void;
  creditPriceRm: number;
  loading?: boolean;
}

const PAYG_FEATURES = [
  "No subscription, no recurring fees",
  "Credits never expire",
  "Buy 1, 5, or 10 credits at a time",
];

const PRO_FEATURES = [
  "10 meeting credits every month",
  "Priority transcription & processing",
  "Unused credits roll over",
  "Cancel anytime",
];

/**
 * Marketing pricing block shown on the signed-out landing page. Both CTAs funnel
 * to sign-in, where a plan can be selected. Prices are in MYR.
 */
export function LandingPricing({ onGetStarted, creditPriceRm, loading = false }: LandingPricingProps) {
  return (
    <section className="max-w-4xl w-full mx-auto px-6 pb-16">
      <div className="text-center mb-10">
        <h2 className="text-2xl sm:text-3xl font-light text-slate-100 tracking-tight">
          Simple, transparent pricing
        </h2>
        <p className="text-slate-400 text-sm mt-3 max-w-md mx-auto">
          Subscribe for regular meetings, or pay as you go — whichever suits your workflow.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        {/* Pay As You Go */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 flex flex-col">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-indigo-400" />
            <h3 className="text-lg font-bold text-slate-100">Pay As You Go</h3>
          </div>
          <div className="mt-5 flex items-baseline gap-1.5">
            <span className="text-4xl font-black text-slate-100">RM{creditPriceRm}</span>
            <span className="text-slate-400 text-sm">/ credit</span>
          </div>
          <p className="text-sm text-slate-400 mt-2">One credit covers one meeting.</p>
          <ul className="mt-6 space-y-3 text-sm text-slate-300 flex-1">
            {PAYG_FEATURES.map((feature) => (
              <li key={feature} className="flex items-center gap-2">
                <Check className="w-4 h-4 text-indigo-400 shrink-0" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onGetStarted}
            disabled={loading}
            className="w-full mt-7 py-3 px-4 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700/60 disabled:opacity-50"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Get started
          </button>
        </div>

        {/* Pro Monthly subscription */}
        <div className="relative bg-gradient-to-b from-indigo-950/40 to-slate-900 border-2 border-indigo-500/40 rounded-xl p-8 flex flex-col shadow-lg shadow-indigo-500/10">
          <span className="absolute -top-3 left-8 text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full">
            Best value
          </span>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-indigo-400" />
            <h3 className="text-lg font-bold text-slate-100">Pro Monthly</h3>
          </div>
          <div className="mt-5 flex items-baseline gap-1.5">
            <span className="text-4xl font-black text-slate-100">RM299</span>
            <span className="text-slate-400 text-sm">/ month</span>
          </div>
          <p className="text-sm text-slate-400 mt-2">Save ~23% vs buying 10 credits one-time.</p>
          <ul className="mt-6 space-y-3 text-sm text-slate-300 flex-1">
            {PRO_FEATURES.map((feature) => (
              <li key={feature} className="flex items-center gap-2">
                <Check className="w-4 h-4 text-indigo-400 shrink-0" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onGetStarted}
            disabled={loading}
            className="w-full mt-7 py-3 px-4 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-600/20 disabled:opacity-50"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Start Pro subscription
          </button>
        </div>
      </div>

      <p className="text-center text-xs text-slate-500 mt-6">
        All prices in MYR. Sign in to choose a plan.
      </p>
    </section>
  );
}
