interface LandingPricingProps {
  onGetStarted: () => void;
  creditPriceRm: number;
  loading?: boolean;
}

/**
 * Compact plan block for the signed-out landing page: a slim two-column card
 * showing the subscription and pay-as-you-go options. Both funnel to sign-in.
 */
export function LandingPricing({ onGetStarted, creditPriceRm, loading = false }: LandingPricingProps) {
  return (
    <section className="max-w-md w-full mx-auto px-6 pb-12">
      <div className="border-t border-slate-800 pt-8">
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.25em] text-indigo-400 mb-4">
          Plan
        </p>

        <div className="grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-900/60 divide-x divide-slate-800 overflow-hidden">
          <button
            type="button"
            onClick={onGetStarted}
            disabled={loading}
            className="p-5 text-center transition-colors hover:bg-slate-800/40 cursor-pointer disabled:opacity-50"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Pay As You Go</p>
            <p className="mt-2 text-2xl font-bold text-slate-100">
              RM{creditPriceRm}
              <span className="text-sm font-normal text-slate-400"> / credit</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">1 credit = 1 meeting</p>
          </button>

          <button
            type="button"
            onClick={onGetStarted}
            disabled={loading}
            className="p-5 text-center transition-colors hover:bg-slate-800/40 cursor-pointer disabled:opacity-50"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">Pro Monthly</p>
            <p className="mt-2 text-2xl font-bold text-slate-100">
              RM299
              <span className="text-sm font-normal text-slate-400"> / mo</span>
            </p>
            <p className="mt-1 text-xs text-indigo-400">10 credits / month</p>
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-slate-500 leading-relaxed">
          Subscribe for regular meetings, or pay as you go. Cancel anytime.
        </p>
      </div>
    </section>
  );
}
