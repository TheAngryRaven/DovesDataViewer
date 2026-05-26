import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { effectiveTier, type SubscriptionTierRow, type UserSubscriptionRow } from "@/lib/billing";
import { fetchMySubscription, fetchTiers } from "@/lib/billingClient";

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

export interface SubscriptionState {
  loading: boolean;
  error: string | null;
  /** All plans (sorted), for prices/labels/limits. Empty when signed out. */
  tiers: SubscriptionTierRow[];
  /** The user's raw subscription row (may be inactive). */
  subscription: UserSubscriptionRow | null;
  /** The effective tier ('free' when signed out or the subscription is inactive). */
  currentTier: string;
  refresh: () => Promise<void>;
}

/**
 * Reads the catalogue of subscription tiers + the current user's subscription.
 * Online-only and account-gated: returns the free baseline when cloud is
 * disabled or no one is signed in, and never throws into render.
 */
export function useSubscription(): SubscriptionState {
  const { user, loading: authLoading } = useAuth();
  const online = useOnlineStatus();
  const [tiers, setTiers] = useState<SubscriptionTierRow[]>([]);
  const [subscription, setSubscription] = useState<UserSubscriptionRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enableCloud || !user) {
      setTiers([]);
      setSubscription(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const [t, s] = await Promise.all([fetchTiers(), fetchMySubscription(user.id)]);
      setTiers(t);
      setSubscription(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load subscription");
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Re-read on mount, on sign-in/out, and when connectivity returns.
  useEffect(() => {
    void refresh();
  }, [refresh, online]);

  return {
    loading: authLoading || loading,
    error,
    tiers,
    subscription,
    currentTier: effectiveTier(subscription),
    refresh,
  };
}
