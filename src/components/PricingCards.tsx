import { useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation, Trans } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useStripePrices } from "@/hooks/useStripePrices";
import { useSubscription } from "@/hooks/useSubscription";
import {
  type BillingInterval,
  formatPrice,
  isComingSoon,
  paidTiersVisible,
  priceFor,
  pricingCta,
  tiersWithPrices,
} from "@/lib/billing";
import { isNativeApp } from "@/lib/platform";

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

type PaidSlug = "plus" | "premium" | "pro";

// A feature line is either a plain string or a heading with indented sub-bullets.
type Feature = string | { label: string; sub: string[] };

interface FreeTier {
  name: string;
  price: string;
  inherits?: string;
  features: Feature[];
  highlight?: boolean;
  /** Maps the card to a subscription tier slug (the offline card has none). */
  slug?: "free";
}

interface PaidTier {
  name: string;
  inherits: string;
  features: Feature[];
  slug: PaidSlug;
  highlight?: boolean;
}

function FeatureList({ features }: { features: Feature[] }) {
  return (
    <ul className="mt-2 space-y-2">
      {features.map((f) => {
        const label = typeof f === "string" ? f : f.label;
        const sub = typeof f === "string" ? undefined : f.sub;
        return (
          <li key={label} className="text-sm text-foreground">
            <div className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{label}</span>
            </div>
            {sub && (
              <ul className="mt-1 space-y-1 pl-6">
                {sub.map((s) => (
                  <li key={s} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TierCard({
  name,
  price,
  cadence,
  currencyNote,
  inherits,
  features,
  highlight,
  recommendedLabel,
  cta,
}: {
  name: string;
  price: string;
  cadence?: string;
  currencyNote?: string;
  inherits?: string;
  features: Feature[];
  highlight?: boolean;
  recommendedLabel: string;
  cta?: ReactNode;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-xl border bg-card p-5 text-left ${
        highlight ? "border-primary ring-1 ring-primary/40" : "border-border"
      }`}
    >
      {highlight && (
        <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
          {recommendedLabel}
        </span>
      )}
      <h3 className="text-xl font-bold text-foreground">{name}</h3>
      {price && (
        <div className="mt-3 flex items-baseline gap-1">
          <span className="text-2xl font-bold text-foreground">{price}</span>
          {currencyNote && <span className="text-sm text-muted-foreground">{currencyNote}</span>}
          {cadence && <span className="text-sm text-muted-foreground">{cadence}</span>}
        </div>
      )}
      {inherits && <p className="mt-3 text-xs font-medium text-muted-foreground">{inherits}</p>}
      <FeatureList features={features} />
      {cta && <div className="mt-auto pt-4">{cta}</div>}
    </div>
  );
}

function IntervalToggle({
  value,
  onChange,
  labels,
}: {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
  labels: Record<BillingInterval, string>;
}) {
  return (
    <div className="mt-4 inline-flex items-center rounded-full border border-border bg-card p-0.5 text-sm">
      {(["monthly", "annual"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-full px-3 py-1 transition-colors ${
            value === opt
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={value === opt}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}

type Variant = "home" | "register";

/**
 * Plans / pricing grid.
 * - `home` (landing page): three cards — Just the App (offline), free Cloud
 *   Access (online), paid Cloud Access (Plus) — with a monthly/annual toggle;
 *   signed-in users get live "Upgrade" / "Current plan" actions on the paid card.
 * - `register` (sign-up): two cards — free Cloud Access (which folds in the
 *   offline summary) and paid Cloud Access (Plus) — and no interval toggle (the
 *   billing interval is chosen in the checkout below the cards).
 * Premium + Pro are coming-soon and hidden entirely. When Stripe isn't configured
 * the paid cards drop out (free-only failback).
 */
export function PricingCards({ className, variant = "home" }: { className?: string; variant?: Variant }) {
  const { t } = useTranslation("auth");
  const { user } = useAuth();
  const { currentTier } = useSubscription();
  const { config } = useStripePrices();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [busy, setBusy] = useState<string | null>(null);

  const signedIn = !!user;
  // The native (Android) app sells nothing in-app (Google Play billing policy):
  // hide the paid cards and every CTA — the offline/free cards stay informational.
  const native = isNativeApp();
  const showPaid = paidTiersVisible(config) && !native;
  const purchasable = tiersWithPrices(config.prices);
  // The cards' interval: the toggle on home, fixed monthly on sign-up.
  const cardInterval: BillingInterval = variant === "register" ? "monthly" : interval;
  const cadence = cardInterval === "annual" ? t("pricing.cadenceYear") : t("pricing.cadenceMonth");
  const showToggle = variant === "home" && showPaid;

  // Feature copy is localized; prices resolve live from Stripe (see billing.ts).
  const cloudSync: Feature = {
    label: t("pricing.cloudSync.label"),
    sub: t("pricing.cloudSync.sub", { returnObjects: true }) as string[],
  };
  const offlineCard: FreeTier = {
    name: t("pricing.offlineCard.name"),
    price: t("pricing.free"),
    features: t("pricing.offlineCard.features", { returnObjects: true }) as string[],
  };
  const onlineCard: FreeTier = {
    name: t("pricing.onlineCard.name"),
    price: t("pricing.free"),
    slug: "free",
    inherits: variant === "register" ? t("pricing.onlineCard.inheritsRegister") : t("pricing.onlineCard.inheritsHome"),
    features: [cloudSync, ...(t("pricing.onlineCard.features", { returnObjects: true }) as string[])],
  };
  const allPaidTiers: PaidTier[] = [
    { name: t("pricing.plus.name"), slug: "plus", highlight: true, inherits: t("pricing.plus.inherits"), features: t("pricing.plus.features", { returnObjects: true }) as string[] },
    { name: t("pricing.premium.name"), slug: "premium", inherits: t("pricing.premium.inherits"), features: t("pricing.premium.features", { returnObjects: true }) as string[] },
    { name: t("pricing.pro.name"), slug: "pro", inherits: t("pricing.pro.inherits"), features: t("pricing.pro.features", { returnObjects: true }) as string[] },
  ];

  const freeCards: FreeTier[] = variant === "register" ? [onlineCard] : [offlineCard, onlineCard];
  // Only self-service-purchasable paid tiers (Premium/Pro are hidden at launch).
  const paidTiers = allPaidTiers.filter((tier) => !isComingSoon(tier.slug));

  const onUpgrade = async (slug: PaidSlug) => {
    setBusy(slug);
    try {
      // Dynamic import: billingClient pulls the Supabase client, which must
      // stay off the eager graph (these cards ride the landing page).
      const { createCheckout } = await import("@/lib/billingClient");
      const url = await createCheckout(slug, cardInterval, window.location.href);
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pricing.checkoutError"));
      setBusy(null);
    }
  };

  // Already-subscribed users change plans through the billing portal (Stripe
  // swaps the plan on the existing subscription with proration) — starting a new
  // Checkout would create a duplicate, double-billed subscription.
  const onManage = async (slug: PaidSlug) => {
    setBusy(slug);
    try {
      const { createPortal } = await import("@/lib/billingClient");
      const url = await createPortal(window.location.href);
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pricing.portalError"));
      setBusy(null);
    }
  };

  const ctaFor = (slug: "free" | PaidSlug, isPaid: boolean): ReactNode => {
    const kind = pricingCta({
      slug,
      signedIn,
      cloudEnabled: enableCloud,
      currentTier,
      purchasable: purchasable.has(slug),
      native,
    });
    if (kind === "current") {
      return (
        <Button variant="outline" className="w-full" disabled>
          <Check className="h-4 w-4" /> {t("pricing.currentPlan")}
        </Button>
      );
    }
    if (kind === "upgrade" && isPaid) {
      const isBusy = busy === slug;
      return (
        <Button className="w-full" disabled={isBusy} onClick={() => void onUpgrade(slug as PaidSlug)}>
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isBusy ? t("pricing.redirecting") : t("pricing.upgrade")}
        </Button>
      );
    }
    if (kind === "manage" && isPaid) {
      const isBusy = busy === slug;
      return (
        <Button variant="outline" className="w-full" disabled={isBusy} onClick={() => void onManage(slug as PaidSlug)}>
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isBusy ? t("pricing.redirecting") : t("pricing.changePlan")}
        </Button>
      );
    }
    return null;
  };

  // Two cards on sign-up centre nicely at two columns; the landing page goes
  // three across from the tablet breakpoint up (single column on phones).
  const gridCols = variant === "register" ? "sm:grid-cols-2" : "sm:grid-cols-3";
  const recommendedLabel = t("pricing.recommended");

  return (
    <section className={className}>
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold text-foreground">{t("pricing.heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("pricing.subtitle")}</p>
        {showToggle && (
          <div className="flex justify-center">
            <IntervalToggle
              value={interval}
              onChange={setInterval}
              labels={{ monthly: t("pricing.monthly"), annual: t("pricing.annual") }}
            />
          </div>
        )}
      </div>
      <div className={`mt-6 grid gap-4 ${gridCols}`}>
        {freeCards.map((tier) => (
          <TierCard
            key={tier.slug ?? tier.name}
            name={tier.name}
            price={tier.price}
            inherits={tier.inherits}
            features={tier.features}
            highlight={tier.highlight}
            recommendedLabel={recommendedLabel}
            cta={tier.slug ? ctaFor(tier.slug, false) : null}
          />
        ))}
        {showPaid &&
          paidTiers.map((tier) => {
            const price = priceFor(config.prices, tier.slug, cardInterval);
            // Hidden when this interval isn't priced in Stripe.
            if (!price) return null;
            return (
              <TierCard
                key={tier.slug}
                name={tier.name}
                price={formatPrice(price.unitAmount, price.currency)}
                cadence={cadence}
                currencyNote={t("pricing.usd")}
                inherits={tier.inherits}
                features={tier.features}
                highlight={tier.highlight}
                recommendedLabel={recommendedLabel}
                cta={ctaFor(tier.slug, true)}
              />
            );
          })}
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        <Trans t={t} i18nKey="pricing.footnote" components={{ b: <span className="font-medium text-foreground" /> }} />
      </p>
    </section>
  );
}
