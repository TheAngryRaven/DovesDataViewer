import { cn } from "@/lib/utils";

// The PerchWerks bird mark, shared by every PerchWerks family (source of truth:
// perchwerks-style brand/logos/mark.svg). Inlined rather than an <img> so it
// fills with currentColor and follows the theme; defaults to the brand accent.
// Callers size it by height (it's 2.25:1) — e.g. `h-4`.
const MARK_PATH =
  "M0 0-46.401-46.397C-63.511-63.506-88.984-69.153-111.722-60.877L-297.871 6.876C-300.975 8.006-300.165 12.604-296.86 12.604H-148.313C-145.009 12.604-144.198 17.203-147.303 18.333L-264.835 61.098C-267.94 62.228-267.13 66.827-263.825 66.827H-45.016C-38.438 66.827-35.144 58.874-39.795 54.223L-76.372 17.646C-78.233 15.785-76.915 12.604-74.284 12.604H-5.221C1.357 12.604 4.652 4.651 0 0";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 3056.27 1359.8"
      role="img"
      aria-label="LapWing"
      className={cn("h-4 w-auto shrink-0 text-primary", className)}
    >
      <g transform="translate(-478.447 -467.697)">
        <path fill="currentColor" transform="matrix(10,0,0,-10,3488.197,1135.967)" d={MARK_PATH} />
      </g>
    </svg>
  );
}

// The full LAPWING lockup (mark + logotype). The logotype has no vector master
// yet — the brand repo ships it as raster only — so this swaps the two duotone
// PNGs by theme. Size by height; keep it ≥ 120px wide per the brand book.
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0", className)}>
      <img src="/brand/lapwing-lockup-duotone-on-light.png" alt="LapWing" className="h-full w-auto dark:hidden" />
      <img src="/brand/lapwing-lockup-duotone-on-dark.png" alt="LapWing" className="hidden h-full w-auto dark:block" />
    </span>
  );
}
