import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  type BillingInterval,
  type StripeConfig,
  annualDiscountPercent,
  annualMonthlyEquivalent,
  formatPrice,
  isComingSoon,
  paidTiersVisible,
  priceFor,
  tiersWithPrices,
  TIER_DISPLAY_LABEL,
  TIER_STORAGE_LABEL,
} from "@/lib/billing";

export interface PlanSelection {
  tier: string;
  interval: BillingInterval;
}

const PAID_ORDER = ["plus", "premium", "pro"];

/** The purchasable storage tiers for the dropdown (free + any priced, non-coming-soon paid tier). */
function selectableTiers(config: StripeConfig): string[] {
  const available = tiersWithPrices(config.prices);
  return ["free", ...PAID_ORDER.filter((t) => available.has(t) && !isComingSoon(t))];
}

/**
 * Checkout-style plan picker for sign-up: a storage-tier dropdown plus a
 * monthly/annual switch. Renders nothing when Stripe isn't configured (the
 * account is simply free — no checkout to show). Controlled: the parent owns the
 * selection so it can stash it for post-confirmation checkout and render the live
 * price next to the submit button (see PlanCheckoutSummary).
 */
export function PlanCheckout({
  value,
  onChange,
  config,
}: {
  value: PlanSelection;
  onChange: (v: PlanSelection) => void;
  config: StripeConfig;
}) {
  const { t } = useTranslation("auth");
  if (!paidTiersVisible(config)) return null;
  const tiers = selectableTiers(config);
  if (tiers.length <= 1) return null; // only "free" — nothing to choose

  const setInterval = (interval: BillingInterval) => {
    // If the chosen tier isn't priced for the new interval, fall back to free.
    if (value.tier !== "free" && !priceFor(config.prices, value.tier, interval)) {
      onChange({ tier: "free", interval });
    } else {
      onChange({ ...value, interval });
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card/50 p-3">
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground" htmlFor="storage-tier">
          {t("planCheckout.storageTier")}
        </label>
        <Select value={value.tier} onValueChange={(tier) => onChange({ ...value, tier })}>
          <SelectTrigger id="storage-tier">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tiers.map((tier) => (
              <SelectItem key={tier} value={tier}>
                {TIER_DISPLAY_LABEL[tier] ?? tier} — {TIER_STORAGE_LABEL[tier] ?? ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{t("planCheckout.billing")}</span>
        <div className="flex items-center gap-2 text-sm">
          <span className={value.interval === "monthly" ? "text-foreground" : "text-muted-foreground"}>
            {t("planCheckout.monthly")}
          </span>
          <Switch
            checked={value.interval === "annual"}
            onCheckedChange={(checked) => setInterval(checked ? "annual" : "monthly")}
            aria-label={t("planCheckout.billAnnually")}
          />
          <span className={value.interval === "annual" ? "text-foreground" : "text-muted-foreground"}>
            {t("planCheckout.annual")}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The live cost-per-month readout shown next to the Create Account button. For
 * annual plans it shows the monthly-equivalent price plus the % discount versus
 * paying monthly. Renders nothing when Stripe isn't configured.
 */
export function PlanCheckoutSummary({
  value,
  config,
}: {
  value: PlanSelection;
  config: StripeConfig;
}) {
  const { t } = useTranslation("auth");
  if (!paidTiersVisible(config)) return null;

  if (value.tier === "free") {
    return (
      <div className="leading-tight">
        <p className="text-lg font-bold text-foreground">
          $0 <span className="text-xs font-normal text-muted-foreground">{t("planCheckout.perMonth")}</span>
        </p>
        <p className="text-[11px] text-muted-foreground">{t("planCheckout.freeForever")}</p>
      </div>
    );
  }

  const monthly = priceFor(config.prices, value.tier, "monthly");
  const selected = priceFor(config.prices, value.tier, value.interval);
  if (!selected) return null;

  const isAnnual = value.interval === "annual";
  const perMonth = isAnnual ? annualMonthlyEquivalent(selected.unitAmount) : selected.unitAmount;
  const discount = isAnnual ? annualDiscountPercent(monthly?.unitAmount, selected.unitAmount) : null;

  return (
    <div className="leading-tight">
      <p className="text-lg font-bold text-foreground">
        {formatPrice(perMonth, selected.currency)}{" "}
        <span className="text-xs font-normal text-muted-foreground">{t("planCheckout.perMonth")}</span>
      </p>
      {isAnnual ? (
        <p className="text-[11px] text-muted-foreground">
          {t("planCheckout.billedAnnually")}
          {discount != null && (
            <span className="ml-1 font-medium text-emerald-600 dark:text-emerald-500">{t("planCheckout.save", { discount })}</span>
          )}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">{t("planCheckout.billedMonthly")}</p>
      )}
    </div>
  );
}
