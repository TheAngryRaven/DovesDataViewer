import { useEffect, useState } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { StripeConfig } from "@/lib/billing";
import { fetchStripeConfig } from "@/lib/billingClient";

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

export interface StripePricesState {
  loading: boolean;
  config: StripeConfig;
}

const UNCONFIGURED: StripeConfig = { configured: false, prices: [] };

/**
 * Reads the live Stripe pricing catalogue (monthly/annual prices per paid tier)
 * for the pricing UI. Online-only and cloud-gated; never throws into render —
 * any failure reads as "not configured", which collapses the UI to the free
 * cards. Public data, so it works signed-out.
 */
export function useStripePrices(): StripePricesState {
  const online = useOnlineStatus();
  const [config, setConfig] = useState<StripeConfig>(UNCONFIGURED);
  const [loading, setLoading] = useState(enableCloud);

  useEffect(() => {
    if (!enableCloud) {
      setConfig(UNCONFIGURED);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchStripeConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        if (!cancelled) setConfig(UNCONFIGURED);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [online]);

  return { loading, config };
}
