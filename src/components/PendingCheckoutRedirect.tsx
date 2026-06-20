import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSubscription } from "@/hooks/useSubscription";
import { isPaidTier } from "@/lib/billing";
import { createCheckout } from "@/lib/billingClient";
import { clearPendingCheckout, getPendingCheckout } from "@/lib/pendingCheckout";
import { isNativeApp } from "@/lib/platform";

/**
 * Resumes a paid plan chosen at sign-up. Sign-up creates the account first
 * (email confirmation, no session), so the choice is stashed and redeemed here
 * on the user's first signed-in, online load while still on the free tier:
 * redirect to Stripe Checkout, then the webhook provisions the tier. Renders
 * nothing. Mounted once at the app root in cloud builds.
 */
export function PendingCheckoutRedirect() {
  const { user, loading: authLoading } = useAuth();
  const online = useOnlineStatus();
  const { currentTier, loading: subLoading } = useSubscription();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    // Never resume a web checkout inside the native app (Google Play billing
    // policy). A plan stashed on the web stays dormant here.
    if (isNativeApp()) return;
    if (authLoading || subLoading || !user || !online) return;
    if (currentTier !== "free") {
      // Already on a paid tier — the intent (if any) is satisfied; drop it.
      clearPendingCheckout();
      return;
    }
    const intent = getPendingCheckout();
    if (!intent || !isPaidTier(intent.tier)) return;

    started.current = true;
    clearPendingCheckout();
    createCheckout(intent.tier, intent.interval, window.location.origin)
      .then((url) => {
        window.location.href = url;
      })
      .catch((e) => {
        started.current = false;
        toast.error(e instanceof Error ? e.message : "Couldn't resume checkout.");
      });
  }, [user, authLoading, subLoading, currentTier, online]);

  return null;
}
