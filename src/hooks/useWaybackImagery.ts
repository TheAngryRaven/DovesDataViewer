import { useCallback, useEffect, useState } from 'react';
import { fetchWaybackReleases, type WaybackRelease } from '@/lib/satelliteImagery';

export interface UseWaybackImagery {
  releases: WaybackRelease[];
  loading: boolean;
  error: boolean;
  /** Trigger the (one-time) fetch — called when the imagery-date picker opens. */
  load: () => void;
}

/**
 * Lazily loads the Esri Wayback release list the first time `load()` is called
 * (i.e. when the user actually reaches for the satellite imagery-date picker),
 * so the config fetch stays off the initial path and never runs for offline
 * users who only use the default imagery. The underlying fetch is memoised in
 * `satelliteImagery.ts`, so multiple maps share one request.
 */
export function useWaybackImagery(): UseWaybackImagery {
  const [releases, setReleases] = useState<WaybackRelease[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [requested, setRequested] = useState(false);

  const load = useCallback(() => setRequested(true), []);

  // Depend ONLY on `requested`. Including `loading` here would be fatal: the
  // effect flips `loading` true, which would re-run the effect, whose cleanup
  // sets `cancelled` on the in-flight request — cancelling our own fetch one
  // tick after starting it (loading stuck true forever). `fetchWaybackReleases`
  // memoises its promise, so a StrictMode double-mount re-attaches handlers to
  // the same request and results still land.
  useEffect(() => {
    if (!requested) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchWaybackReleases()
      .then((r) => { if (!cancelled) setReleases(r); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requested]);

  return { releases, loading, error, load };
}
