interface LandingPricingProps {
  onGetStarted: () => void;
  creditPriceRm: number;
  loading?: boolean;
}

export function LandingPricing({ onGetStarted, creditPriceRm, loading = false }: LandingPricingProps) {
  const packs = [
    { credits: 1, price: creditPriceRm, note: "Try one meeting" },
    { credits: 5, price: Math.round(creditPriceRm * 5 * 0.7 * 100) / 100, note: "30% off" },
    { credits: 10, price: Math.round(creditPriceRm * 10 * 0.6 * 100) / 100, note: "40% off" },
  ] as const;

  return (
    <section className="max-w-4xl w-full mx-auto px-4 sm:px-6 pb-12 sm:pb-16">
      <div className="border-t border-slate-200 pt-10">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-blue-600 mb-2">
          Pricing
        </p>
        <p className="text-center text-sm text-slate-500 mb-6">
          Pay as you go — 1 credit = 1 meeting. No subscription required.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {packs.map((pack) => (
            <button
              key={pack.credits}
              type="button"
              onClick={onGetStarted}
              disabled={loading}
              className="mf-card mf-card-hover min-h-20 p-4 text-left cursor-pointer disabled:opacity-50"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {pack.credits} credit{pack.credits !== 1 ? "s" : ""}
              </p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                RM{pack.price}
                {pack.credits > 1 && (
                  <span className="ml-2 text-xs font-semibold text-emerald-600">{pack.note}</span>
                )}
              </p>
              {pack.credits === 1 && <p className="mt-1 text-xs text-slate-500">{pack.note}</p>}
            </button>
          ))}
        </div>

        <p className="mt-4 text-center text-xs text-slate-500 leading-relaxed">
          Sign in to purchase credits. Credits never expire.
        </p>
      </div>
    </section>
  );
}
