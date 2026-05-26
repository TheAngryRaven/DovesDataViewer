import { Check } from "lucide-react";

interface Tier {
  name: string;
  blurb: string;
  price: string;
  cadence?: string;
  inherits?: string;
  features: string[];
  highlight?: boolean;
  comingSoon?: boolean;
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
    inherits: "Everything in Free online, plus",
    features: ["500 MB cloud log storage"],
  },
  {
    name: "Pro",
    blurb: "With AI coaching",
    price: "$10",
    cadence: "/mo",
    comingSoon: true,
    inherits: "Everything in Plus, plus",
    features: ["4 GB cloud log storage", "AI coaching (coming soon)"],
  },
];

function TierCard({ tier, compact }: { tier: Tier; compact?: boolean }) {
  return (
    <div
      className={`relative flex flex-col rounded-xl border bg-card text-left ${
        compact ? "p-4" : "p-5"
      } ${tier.highlight ? "border-primary ring-1 ring-primary/40" : "border-border"}`}
    >
      {tier.highlight && (
        <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
          Recommended
        </span>
      )}
      {tier.comingSoon && (
        <span className="absolute -top-2.5 right-4 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Coming soon
        </span>
      )}
      <div className="space-y-0.5">
        <h3 className={`font-semibold text-foreground ${compact ? "text-sm" : "text-base"}`}>{tier.name}</h3>
        <p className="text-xs text-muted-foreground">{tier.blurb}</p>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className={`font-bold text-foreground ${compact ? "text-xl" : "text-2xl"}`}>{tier.price}</span>
        {tier.cadence && <span className="text-sm text-muted-foreground">{tier.cadence}</span>}
      </div>
      {tier.inherits && (
        <p className="mt-3 text-xs font-medium text-muted-foreground">{tier.inherits}</p>
      )}
      <ul className={`mt-2 ${compact ? "space-y-1.5" : "space-y-2"}`}>
        {tier.features.map((f) => (
          <li key={f} className={`flex items-start gap-2 text-foreground ${compact ? "text-xs" : "text-sm"}`}>
            <Check className={`mt-0.5 shrink-0 text-primary ${compact ? "h-3.5 w-3.5" : "h-4 w-4"}`} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Plans / pricing grid. Shown on the landing page (below the sample box) and on
 * the registration page (above the form, `compact`). Informational only — paid
 * tiers are marked "Coming soon" until billing is wired up.
 */
export function PricingCards({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <section className={className}>
      <div className="text-center space-y-1">
        <h2 className={`font-bold text-foreground ${compact ? "text-lg" : "text-xl"}`}>Plans &amp; pricing</h2>
        <p className={`text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}>
          Start free and fully offline. Add an account for cross-device sync — upgrade only if you need more.
        </p>
      </div>
      <div className={`grid sm:grid-cols-2 lg:grid-cols-4 ${compact ? "mt-4 gap-3" : "mt-6 gap-4"}`}>
        {TIERS.map((tier) => (
          <TierCard key={`${tier.name}-${tier.blurb}`} tier={tier} compact={compact} />
        ))}
      </div>
    </section>
  );
}
