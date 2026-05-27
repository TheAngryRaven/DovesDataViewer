import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStripePrices } from "@/hooks/useStripePrices";
import {
  type BillingInterval,
  formatPrice,
  isComingSoon,
  paidTiersVisible,
  priceFor,
  tiersWithPrices,
} from "@/lib/billing";

export interface PlanSelection {
  tier: string;
  interval: BillingInterval;
}

const TIER_LABEL: Record<string, string> = {
  free: "Free",
  plus: "Plus",
  premium: "Premium",
  pro: "Pro",
};
const PAID_ORDER = ["plus", "premium", "pro"];

/**
 * Plan + billing-interval picker for sign-up. Renders nothing when Stripe isn't
 * configured (the account is simply free), so the failback needs no special
 * handling. Controlled: the parent owns the selection so it can act on submit.
 */
export function PlanChooser({
  value,
  onChange,
}: {
  value: PlanSelection;
  onChange: (v: PlanSelection) => void;
}) {
  const { config } = useStripePrices();
  if (!paidTiersVisible(config)) return null;

  const available = tiersWithPrices(config.prices);
  // Coming-soon tiers (e.g. the AI plan) aren't self-service purchasable at
  // sign-up — they're comped manually via Stripe, not chosen here.
  const paidTiers = PAID_ORDER.filter((t) => available.has(t) && !isComingSoon(t));
  if (paidTiers.length === 0) return null;
  const isPaid = value.tier !== "free";

  const setInterval = (interval: BillingInterval) => {
    // If the chosen tier isn't priced for the new interval, fall back to free.
    if (value.tier !== "free" && !priceFor(config.prices, value.tier, interval)) {
      onChange({ tier: "free", interval });
    } else {
      onChange({ ...value, interval });
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground" htmlFor="plan">
        Plan
      </label>
      <Select value={value.tier} onValueChange={(tier) => onChange({ ...value, tier })}>
        <SelectTrigger id="plan">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="free">Free — $0</SelectItem>
          {paidTiers.map((tier) => {
            const price = priceFor(config.prices, tier, value.interval);
            return (
              <SelectItem key={tier} value={tier}>
                {TIER_LABEL[tier] ?? tier}
                {price
                  ? ` — ${formatPrice(price.unitAmount, price.currency)}${
                      value.interval === "annual" ? "/yr" : "/mo"
                    }`
                  : ""}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {isPaid && (
        <div className="inline-flex items-center rounded-full border border-border bg-card p-0.5 text-sm">
          {(["monthly", "annual"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setInterval(opt)}
              className={`rounded-full px-3 py-1 capitalize transition-colors ${
                value.interval === opt
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={value.interval === opt}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {isPaid && (
        <p className="text-xs text-muted-foreground">
          You'll be sent to secure checkout after confirming your email and signing in.
        </p>
      )}
    </div>
  );
}
