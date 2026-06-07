import { useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { createCheckout, createPortal } from "@/lib/billingClient";

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

// Everything the always-free, fully-offline app does — no account needed. Shown
// as its own card on the landing page and folded into the online card on sign-up.
const OFFLINE_FEATURES: string[] = [
  "Full data viewer",
  "Bluetooth (BLE) device connectivity",
  "Reference-lap overlay & comparison",
  "Braking zones & G-force analysis",
  "Add overlays & export videos",
  "Offline mathematical session debrief",
];

// What syncing to the cloud (the free online account) actually buys you.
const CLOUD_SYNC_FEATURE: Feature = {
  label: "Sync data with the cloud",
  sub: [
    "Unique setup for each session",
    "Fastest laptimes per engine",
    "Personal tracks and session notes",
  ],
};

const OFFLINE_CARD: FreeTier = {
  name: "Just the App",
  price: "Free",
  features: OFFLINE_FEATURES,
};

// The online free card. On sign-up it leads with the offline summary (there's no
// separate offline card there); on the landing page offline is its own card, so
// it just inherits from it.
function onlineCard(variant: Variant): FreeTier {
  return {
    name: "Cloud Access",
    price: "Free",
    slug: "free",
    inherits: variant === "register" ? "Everything included with offline mode" : "Everything in Just the App, plus",
    features: [CLOUD_SYNC_FEATURE, "Fastest laps & synced setups — always free", "50 MB cloud storage for datalogs*"],
  };
}

// Paid tiers — feature copy is static; the price is resolved live from Stripe
// (by lookup_key) and these cards are hidden when Stripe isn't wired up. Premium
// + Pro are coming-soon (see billing.ts COMING_SOON_TIERS) and hidden entirely.
const PAID_TIERS: PaidTier[] = [
  {
    name: "Cloud Access",
    slug: "plus",
    highlight: true,
    inherits: "Everything in free Cloud Access, plus",
    features: [
      "10 GB cloud storage for datalogs*",
      "Video uploads & sharing (coming soon)",
      "You're helping support the project ❤️",
    ],
  },
  {
    name: "Cloud Access",
    slug: "premium",
    inherits: "Everything in Plus, plus",
    features: ["100 GB cloud storage for datalogs*"],
  },
  {
    name: "Cloud Access",
    slug: "pro",
    inherits: "Everything in Premium, plus",
    features: ["500 GB cloud storage for datalogs*", "AI coaching (coming soon)"],
  },
];

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
  inherits,
  features,
  highlight,
  cta,
}: {
  name: string;
  price: string;
  cadence?: string;
  inherits?: string;
  features: Feature[];
  highlight?: boolean;
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
          Recommended
        </span>
      )}
      <h3 className="text-xl font-bold text-foreground">{name}</h3>
      {price && (
        <div className="mt-3 flex items-baseline gap-1">
          <span className="text-2xl font-bold text-foreground">{price}</span>
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
}: {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
}) {
  return (
    <div className="mt-4 inline-flex items-center rounded-full border border-border bg-card p-0.5 text-sm">
      {(["monthly", "annual"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-full px-3 py-1 capitalize transition-colors ${
            value === opt
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={value === opt}
        >
          {opt}
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
  const { user } = useAuth();
  const { currentTier } = useSubscription();
  const { config } = useStripePrices();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [busy, setBusy] = useState<string | null>(null);

  const signedIn = !!user;
  const showPaid = paidTiersVisible(config);
  const purchasable = tiersWithPrices(config.prices);
  // The cards' interval: the toggle on home, fixed monthly on sign-up.
  const cardInterval: BillingInterval = variant === "register" ? "monthly" : interval;
  const cadence = cardInterval === "annual" ? "/yr" : "/mo";
  const showToggle = variant === "home" && showPaid;

  const freeCards: FreeTier[] = variant === "register" ? [onlineCard(variant)] : [OFFLINE_CARD, onlineCard(variant)];
  // Only self-service-purchasable paid tiers (Premium/Pro are hidden at launch).
  const paidTiers = PAID_TIERS.filter((t) => !isComingSoon(t.slug));

  const onUpgrade = async (slug: PaidSlug) => {
    setBusy(slug);
    try {
      const url = await createCheckout(slug, cardInterval, window.location.href);
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start checkout.");
      setBusy(null);
    }
  };

  // Already-subscribed users change plans through the billing portal (Stripe
  // swaps the plan on the existing subscription with proration) — starting a new
  // Checkout would create a duplicate, double-billed subscription.
  const onManage = async (slug: PaidSlug) => {
    setBusy(slug);
    try {
      const url = await createPortal(window.location.href);
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open the billing portal.");
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
    });
    if (kind === "current") {
      return (
        <Button variant="outline" className="w-full" disabled>
          <Check className="h-4 w-4" /> Current plan
        </Button>
      );
    }
    if (kind === "upgrade" && isPaid) {
      const isBusy = busy === slug;
      return (
        <Button className="w-full" disabled={isBusy} onClick={() => void onUpgrade(slug as PaidSlug)}>
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isBusy ? "Redirecting…" : "Upgrade"}
        </Button>
      );
    }
    if (kind === "manage" && isPaid) {
      const isBusy = busy === slug;
      return (
        <Button variant="outline" className="w-full" disabled={isBusy} onClick={() => void onManage(slug as PaidSlug)}>
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isBusy ? "Redirecting…" : "Change plan"}
        </Button>
      );
    }
    return null;
  };

  // Two cards on sign-up centre nicely at two columns; the landing page goes
  // three across from the tablet breakpoint up (single column on phones).
  const gridCols = variant === "register" ? "sm:grid-cols-2" : "sm:grid-cols-3";

  return (
    <section className={className}>
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold text-foreground">Plans &amp; pricing</h2>
        <p className="text-sm text-muted-foreground">
          Start free and fully offline. Add an account for cross-device sync — upgrade only if you need more.
        </p>
        {showToggle && (
          <div className="flex justify-center">
            <IntervalToggle value={interval} onChange={setInterval} />
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
                inherits={tier.inherits}
                features={tier.features}
                highlight={tier.highlight}
                cta={ctaFor(tier.slug, true)}
              />
            );
          })}
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        * Storage on your own device is always <span className="font-medium text-foreground">unlimited and free</span>.
        Paid plans only cover <span className="font-medium text-foreground">cloud backups of your datalogs</span> —
        so you can dump as many logs as you like and keep them synced across devices. Upgrading mostly just helps
        support development ❤️
      </p>
    </section>
  );
}
