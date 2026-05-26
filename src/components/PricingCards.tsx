import { useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { pricingCta } from "@/lib/billing";
import { createCheckout } from "@/lib/billingClient";

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

interface Tier {
  name: string;
  blurb: string;
  price: string;
  cadence?: string;
  inherits?: string;
  features: string[];
  highlight?: boolean;
  comingSoon?: boolean;
  /** Maps the card to a subscription tier slug (the offline card has none). */
  slug?: "free" | "plus" | "pro";
}

const TIERS: Tier[] = [
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
      "20 MB cloud log storage",
    ],
  },
  {
    name: "Plus",
    blurb: "For bigger garages",
    price: "$1",
    cadence: "/mo",
    comingSoon: true,
    slug: "plus",
    inherits: "Everything in Free online, plus",
    features: ["500 MB cloud log storage"],
  },
  {
    name: "Pro",
    blurb: "With AI coaching",
    price: "$10",
    cadence: "/mo",
    comingSoon: true,
    slug: "pro",
    inherits: "Everything in Plus, plus",
    features: ["1 GB cloud log storage", "AI coaching (coming soon)"],
  },
];

function TierCard({
  tier,
  cta,
  showComingSoon,
}: {
  tier: Tier;
  cta?: ReactNode;
  showComingSoon: boolean;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-xl border bg-card p-5 text-left ${
        tier.highlight ? "border-primary ring-1 ring-primary/40" : "border-border"
      }`}
    >
      {tier.highlight && (
        <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
          Recommended
        </span>
      )}
      {showComingSoon && (
        <span className="absolute -top-2.5 right-4 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Coming soon
        </span>
      )}
      <div className="space-y-0.5">
        <h3 className="text-base font-semibold text-foreground">{tier.name}</h3>
        <p className="text-xs text-muted-foreground">{tier.blurb}</p>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-foreground">{tier.price}</span>
        {tier.cadence && <span className="text-sm text-muted-foreground">{tier.cadence}</span>}
      </div>
      {tier.inherits && (
        <p className="mt-3 text-xs font-medium text-muted-foreground">{tier.inherits}</p>
      )}
      <ul className="mt-2 space-y-2">
        {tier.features.map((f) => (
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

/**
 * Plans / pricing grid. Shown on the landing page (the empty-state of the main
 * app) and on the registration page. Informational for signed-out visitors;
 * signed-in users get live "Upgrade" / "Current plan" actions on the paid tiers
 * (a paid tier whose Stripe Price isn't configured yet stays "Coming soon").
 */
export function PricingCards({ className }: { className?: string }) {
  const { user } = useAuth();
  const { tiers, currentTier } = useSubscription();
  const [busy, setBusy] = useState<string | null>(null);

  const signedIn = !!user;
  const purchasable = new Set(tiers.filter((t) => t.stripe_price_id).map((t) => t.tier));

  const onUpgrade = async (slug: string) => {
    setBusy(slug);
    try {
      const url = await createCheckout(slug, window.location.href);
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start checkout.");
      setBusy(null);
    }
  };

  return (
    <section className={className}>
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold text-foreground">Plans &amp; pricing</h2>
        <p className="text-sm text-muted-foreground">
          Start free and fully offline. Add an account for cross-device sync — upgrade only if you need more.
        </p>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier) => {
          const kind = pricingCta({
            slug: tier.slug,
            signedIn,
            cloudEnabled: enableCloud,
            currentTier,
            purchasable: !!tier.slug && purchasable.has(tier.slug),
          });

          let cta: ReactNode = null;
          if (kind === "current") {
            cta = (
              <Button variant="outline" className="w-full" disabled>
                <Check className="h-4 w-4" /> Current plan
              </Button>
            );
          } else if (kind === "upgrade" && tier.slug) {
            const slug = tier.slug;
            const isBusy = busy === slug;
            cta = (
              <Button className="w-full" disabled={isBusy} onClick={() => void onUpgrade(slug)}>
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isBusy ? "Redirecting…" : "Upgrade"}
              </Button>
            );
          }

          return (
            <TierCard
              key={`${tier.name}-${tier.blurb}`}
              tier={tier}
              cta={cta}
              showComingSoon={!!tier.comingSoon && kind === "none"}
            />
          );
        })}
      </div>
    </section>
  );
}
