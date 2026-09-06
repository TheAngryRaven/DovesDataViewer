import { useCallback, useEffect, useState } from "react";
import {
  computeReadiness,
  readinessPercent,
  type OfflineReadiness,
} from "@/lib/offlineReadiness";
import { readDeferredAssets, warmOfflineAssets } from "@/lib/offlineWarmup";

export interface OfflineReadinessState {
  state: OfflineReadiness;
  cached: number;
  total: number;
  percent: number;
  /** True while a warm-up started from here is running. */
  working: boolean;
}

const supported = () =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

const countCached = async (urls: string[]): Promise<number> => {
  if (typeof caches === "undefined") return 0;
  const hits = await Promise.all(
    urls.map(async (url) => {
      try {
        return (await caches.match(url)) !== undefined;
      } catch {
        return false;
      }
    }),
  );
  return hits.filter(Boolean).length;
};

/**
 * Live "can this device work with no signal?" state, plus a way to finish the
 * job on demand. Backed by `lib/offlineReadiness` (pure) and `lib/offlineWarmup`
 * (the deferred-asset fetcher); this hook only owns the browser plumbing.
 */
export function useOfflineReadiness(): OfflineReadinessState & {
  prepare: () => void;
} {
  const [assets, setAssets] = useState<string[]>([]);
  const [cached, setCached] = useState(0);
  const [controlled, setControlled] = useState(false);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async (urls: string[]) => {
    setControlled(supported() && navigator.serviceWorker.controller !== null);
    setCached(await countCached(urls));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const urls = await readDeferredAssets();
      if (cancelled) return;
      setAssets(urls);
      await refresh(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // A worker that activates after this page loaded takes control later; that
  // flips "not ready" to ready without any user action, so listen for it.
  useEffect(() => {
    if (!supported()) return;
    const onChange = () => void refresh(assets);
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
  }, [assets, refresh]);

  const prepare = useCallback(() => {
    if (working) return;
    setWorking(true);
    void warmOfflineAssets(assets, { onProgress: (n) => setCached(n) })
      .then(() => refresh(assets))
      .finally(() => setWorking(false));
  }, [assets, refresh, working]);

  return {
    state: computeReadiness({
      serviceWorkerSupported: supported(),
      controlled,
      deferredTotal: assets.length,
      deferredCached: cached,
    }),
    cached,
    total: assets.length,
    percent: readinessPercent(cached, assets.length),
    working,
    prepare,
  };
}
