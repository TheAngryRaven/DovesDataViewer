import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { interceptExternal } from "@/lib/platform";

interface ActionTileProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional accent line under the description (e.g. an incentive nudge). */
  badge?: string;
  /** Click handler — rendered as a <button> unless `href` is set. */
  onClick?: () => void;
  /** When set, the tile renders as an external link instead of a button. */
  href?: string;
  disabled?: boolean;
  /** Native title attribute (tooltip), e.g. for an unsupported action. */
  hint?: string;
  /** Highlight the most important action with the primary accent. */
  featured?: boolean;
  /** Spin the icon (e.g. while an action is in progress). */
  spinning?: boolean;
  className?: string;
}

const TILE_BASE =
  "group flex w-full items-start gap-4 rounded-xl border bg-card p-5 text-left transition-colors " +
  "hover:border-primary/50 hover:bg-accent disabled:pointer-events-none disabled:opacity-50";

/**
 * A big, scannable home-screen action: icon + title + one-line description.
 * Used across the landing page so every primary action reads the same way
 * (replacing the cluster of small outline buttons that used to live inside the
 * file dropzone). Renders as a button by default, or an external link when
 * `href` is provided; either way the visual content is identical.
 */
export function ActionTile({
  icon: Icon,
  title,
  description,
  badge,
  onClick,
  href,
  disabled,
  hint,
  featured,
  spinning,
  className,
}: ActionTileProps) {
  const classes = cn(
    TILE_BASE,
    featured && "border-primary/40 bg-primary/5 hover:bg-primary/10",
    className,
  );

  const content = (
    <>
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
          featured ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
        )}
      >
        <Icon className={cn("h-5 w-5", spinning && "animate-spin")} />
      </span>
      <span className="space-y-1">
        <span className="block font-semibold text-foreground">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
        {badge && <span className="block text-xs font-medium text-primary">{badge}</span>}
      </span>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
        title={hint}
        onClick={(e) => interceptExternal(e, href)}
      >
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} title={hint} className={classes}>
      {content}
    </button>
  );
}
