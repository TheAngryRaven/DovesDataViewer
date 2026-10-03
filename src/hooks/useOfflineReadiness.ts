import { useCallback, useEffect, useState } from "react";
import {
  computeReadiness,
  countCachedAssets,
  readinessPercent,
  type OfflineReadiness,
} from "@/lib/offlineReadiness";
import {
  isDeferredAssetCached,
  readDeferredAssets,
  warmOfflineAssets,
  type DeferredAsset,
} from "@/lib/offlineWarmup";
import { isNativeApp } from "@/lib/platform";

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

/**
 * Live "can this device work with no signal?" state, plus a way to finish the
 * job on demand. Backed by `lib/offlineReadiness` (pure) and `lib/offlineWarmup`
 * (the deferred-asset fetcher); this hook only owns the browser plumbing.
 */
export function useOfflineReadiness(): OfflineReadinessState & {
  prepare: () => void;
} {
  const [assets, setAssets] = useState<DeferredAsset[]>([]);
  const [cached, setCached] = useState(0);
  const [controlled, setControlled] = useState(false);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async (list: DeferredAsset[]) => {
    setControlled(supported() && navigator.serviceWorker.controller !== null);
    setCached(await countCachedAssets(list, isDeferredAssetCached));
  }, []);

  useEffect(() => {
    // The native shell bundles every asset; there is nothing to count or warm.
    if (isNativeApp()) return;
    let cancelled = false;
    void (async () => {
      const list = await readDeferredAssets();
      if (cancelled) return;
      setAssets(list);
      await refresh(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // A worker that activates after this page loaded takes control later; that
  // flips "not ready" to ready without any user action, so listen for it.
  useEffect(() => {
    if (isNativeApp() || !supported()) return;
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
      nativeApp: isNativeApp(),
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
