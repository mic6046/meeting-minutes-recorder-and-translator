import { Check, Loader2, Sparkles } from "lucide-react";

interface BuyCreditsSectionProps {
  formatPackagePrice: (credits: number) => string;
  packagePriceRm: (credits: number) => number;
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
  packagePriceRm,
  creditPriceRm,
  checkingOutPlan,
  onCheckout,
  stripeConfigured,
}: BuyCreditsSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="mf-page-title">Buy credits</h2>
        <p className="mf-page-sub">
          Pay as you go — purchase credits when you need them. No subscriptions, no recurring fees.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
        {PACKAGES.map(({ credits, label, popular }) => {
          const fullPrice = credits * creditPriceRm;
          const price = packagePriceRm(credits);
          const savings = fullPrice > 0 ? Math.round((1 - price / fullPrice) * 100) : 0;
          const perCredit = (price / credits).toFixed(2).replace(/\.00$/, "");
          return (
            <div
              key={credits}
              className={`mf-card mf-card-hover p-5 sm:p-6 flex flex-col justify-between relative ${
                popular ? "ring-2 ring-blue-600/20 border-blue-200" : ""
              }`}
            >
              {popular && (
                <span className="inline-flex self-start mb-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full sm:absolute sm:-top-2.5 sm:left-4 sm:mb-0">
                  Most popular
                </span>
              )}
              {savings > 0 && (
                <span className="inline-flex self-start mb-2 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full sm:absolute sm:-top-2.5 sm:right-4 sm:mb-0">
                  Save {savings}%
                </span>
              )}
              <div>
                <h3 className="text-lg font-bold text-slate-900">{label}</h3>
                <p className="text-sm text-slate-500 mt-1">One-time purchase</p>
                <div className="mt-4 flex items-baseline gap-2 flex-wrap">
                  <span className="text-3xl font-bold tracking-tight text-slate-900">
                    {formatPackagePrice(credits)}
                  </span>
                  {savings > 0 && (
                    <span className="text-sm font-medium text-slate-400 line-through">RM{fullPrice}</span>
                  )}
                </div>
                <ul className="mt-5 space-y-2 text-sm text-slate-600">
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>
                      {credits} meeting credit{credits !== 1 ? "s" : ""}
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>
                      RM{perCredit} per credit
                      {savings > 0 && (
                        <span className="text-emerald-600"> (usually RM{creditPriceRm})</span>
                      )}
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>Credits never expire</span>
                  </li>
                </ul>
              </div>
              <button
                type="button"
                disabled={checkingOutPlan !== null}
                onClick={() => onCheckout(credits)}
                className={`mf-btn w-full mt-6 ${
                  popular ? "mf-btn-primary" : "mf-btn-secondary"
                }`}
              >
                {checkingOutPlan === credits ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {checkingOutPlan === credits ? "Processing..." : `Buy ${label}`}
              </button>
            </div>
          );
        })}
      </div>

      {!stripeConfigured && !import.meta.env.PROD && (
        <p className="text-sm text-blue-600 text-center">
          Stripe is not configured. Local sandbox checkout requires{" "}
          <span className="font-semibold">ALLOW_SIMULATED_PAYMENTS=true</span> on the server.
        </p>
      )}
      {!stripeConfigured && import.meta.env.PROD && (
        <p className="text-sm text-amber-600 text-center">
          Payment processing is being configured. Please check back shortly.
        </p>
      )}
    </div>
  );
}
