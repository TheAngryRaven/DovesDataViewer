import { useNavigate } from "react-router-dom";
import { BrandLockup } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

/**
 * Sticky brand bar (logo + "LapWing") shared by the auth and legal full-page
 * routes (login / register / privacy / terms). Clicking it returns home.
 *
 * It sticks to the top of the viewport and carries the top safe-area inset
 * itself (`safe-area-top`), so its background fills behind the device status bar
 * on native while page content scrolls beneath it. Host pages should therefore
 * use `safe-area-x` (left/right only) rather than `safe-area-inset` to avoid
 * double-padding the top. The accessible name comes from the lockup's
 * alt text — no aria-label needed.
 */
export function BrandHeader({ className }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur safe-area-top",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-4xl items-center px-6 py-3">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BrandLockup className="h-5" />
        </button>
      </div>
    </header>
  );
}
