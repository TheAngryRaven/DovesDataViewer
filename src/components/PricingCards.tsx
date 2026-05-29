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

interface FreeTier {
  name: string;
  blurb: string;
  price: string;
  inherits?: string;
  features: string[];
  highlight?: boolean;
  /** Maps the card to a subscription tier slug (the offline card has none). */
  slug?: "free";
}

interface PaidTier {
  name: string;
  blurb: string;
  inherits: string;
  features: string[];
  slug: PaidSlug;
}

// The two always-on free cards. Prices are fixed ($0) — no Stripe needed.
const FREE_TIERS: FreeTier[] = [
  {
    name: "Free",
    blurb: "Offline",
    price: "$0",
    features: [
      "Full data viewer",
      "Bluetooth (BLE) device connectivity",
      "Save logs to your device",
      "Add overlays & export videos",
      "Offline mathematical session debrief",
    ],
  },
  {
    name: "Free",
    blurb: "Online account",
    price: "$0",
    highlight: true,
    slug: "free",
    inherits: "Everything in Free, plus",
    features: [
      "Setup info synced across all your devices",
      "Sync your personal tracks",
      "50 MB cloud storage",
    ],
  },
];

// Paid tiers — feature copy is static; the price is resolved live from Stripe
// (by lookup_key) and these cards are hidden entirely when Stripe isn't wired up.
const PAID_TIERS: PaidTier[] = [
  {
    name: "Plus",
    blurb: "For bigger garages",
    slug: "plus",
    inherits: "Everything in Free online, plus",
    features: ["10 GB cloud storage"],
  },
  {
    name: "Premium",
    blurb: "Max storage",
    slug: "premium",
    inherits: "Everything in Plus, plus",
    features: ["100 GB cloud storage"],
  },
  {
    name: "Pro",
    blurb: "With AI coaching",
    slug: "pro",
    inherits: "Everything in Premium, plus",
    features: ["500 GB cloud storage", "AI coaching (coming soon)"],
  },
];

function TierCard({
  name,
  blurb,
  price,
  cadence,
  inherits,
  features,
  highlight,
  comingSoon,
  cta,
}: {
  name: string;
  blurb: string;
  price: string;
  cadence?: string;
  inherits?: string;
  features: string[];
  highlight?: boolean;
  comingSoon?: boolean;
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
      {comingSoon && (
        <span className="absolute -top-2.5 right-4 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Coming soon
        </span>
      )}
      <div className="space-y-0.5">
        <h3 className="text-base font-semibold text-foreground">{name}</h3>
        <p className="text-xs text-muted-foreground">{blurb}</p>
      </div>
      {price && (
        <div className="mt-3 flex items-baseline gap-1">
          <span className="text-2xl font-bold text-foreground">{price}</span>
          {cadence && <span className="text-sm text-muted-foreground">{cadence}</span>}
        </div>
      )}
      {inherits && <p className="mt-3 text-xs font-medium text-muted-foreground">{inherits}</p>}
      <ul className="mt-2 space-y-2">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-foreground">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
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

/**
 * Plans / pricing grid. Shown on the landing page (the empty-state of the main
 * app) and on the registration page. The two free cards always render;
 * signed-in users get live "Upgrade" / "Current plan" actions on the paid tiers.
 * When Stripe isn't configured the paid tiers are hidden entirely (free-only
 * failback), and a monthly/annual toggle appears only when paid plans are shown.
 */
export function PricingCards({ className }: { className?: string }) {
  const { user } = useAuth();
  const { currentTier } = useSubscription();
  const { config } = useStripePrices();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [busy, setBusy] = useState<string | null>(null);

  const signedIn = !!user;
  const showPaid = paidTiersVisible(config);
  const purchasable = tiersWithPrices(config.prices);
  const cadence = interval === "annual" ? "/yr" : "/mo";

  const onUpgrade = async (slug: PaidSlug) => {
    setBusy(slug);
    try {
      const url = await createCheckout(slug, interval, window.location.href);
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

  return (
    <section className={className}>
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold text-foreground">Plans &amp; pricing</h2>
        <p className="text-sm text-muted-foreground">
          Start free and fully offline. Add an account for cross-device sync — upgrade only if you need more.
        </p>
        {showPaid && (
          <div className="flex justify-center">
            <IntervalToggle value={interval} onChange={setInterval} />
          </div>
        )}
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {FREE_TIERS.map((tier) => (
          <TierCard
            key={`${tier.name}-${tier.blurb}`}
            name={tier.name}
            blurb={tier.blurb}
            price={tier.price}
            inherits={tier.inherits}
            features={tier.features}
            highlight={tier.highlight}
            cta={tier.slug ? ctaFor(tier.slug, false) : null}
          />
        ))}
        {showPaid &&
          PAID_TIERS.map((tier) => {
            const soon = isComingSoon(tier.slug);
            const price = priceFor(config.prices, tier.slug, interval);
            // Purchasable tiers without a price for this interval are hidden;
            // coming-soon tiers always show (as a teaser) but can't be bought.
            if (!soon && !price) return null;
            return (
              <TierCard
                key={tier.slug}
                name={tier.name}
                blurb={tier.blurb}
                price={price ? formatPrice(price.unitAmount, price.currency) : ""}
                cadence={price ? cadence : undefined}
                inherits={tier.inherits}
                features={tier.features}
                comingSoon={soon}
                cta={soon ? null : ctaFor(tier.slug, true)}
              />
            );
          })}
      </div>
    </section>
  );
}
