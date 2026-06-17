/**
 * Per-session historical weather cache (IndexedDB, local-only).
 *
 * A session's date/time is fixed, so the weather looked up for it never changes.
 * Once resolved, the full result is cached here keyed by file name so reopening
 * a session serves it instantly and we stop re-pinging the weather station / API
 * (e.g. the IEM ASOS endpoint) on every view.
 *
 * This store is intentionally absent from the cloud-sync store list
 * (`plugins/cloud-sync/syncStores.ts`): it's derived data the next device can
 * re-fetch for itself, so syncing it would just waste the user's quota.
 */
import { STORE_NAMES, withReadTransaction, withWriteTransaction } from "./dbUtils";
import type { WeatherData } from "./weatherService";

interface WeatherCacheRecord {
  fileName: string;
  data: WeatherData;
  /** When this entry was cached (epoch ms) — for future TTL/eviction if needed. */
  cachedAt: number;
}

const STORE = STORE_NAMES.WEATHER_CACHE;

/** Return the cached weather for a session file, or null when not cached. */
export async function getCachedWeather(fileName: string): Promise<WeatherData | null> {
  if (!fileName) return null;
  const record = await withReadTransaction<WeatherCacheRecord | undefined>(
    STORE,
    (store) => store.get(fileName),
  );
  return record?.data ?? null;
}

/** Cache the resolved weather for a session file. */
export async function saveCachedWeather(fileName: string, data: WeatherData): Promise<void> {
  if (!fileName) return;
  await withWriteTransaction(STORE, (store) => {
    store.put({ fileName, data, cachedAt: Date.now() } satisfies WeatherCacheRecord);
  });
}

/** Drop a session's cached weather (e.g. when its file is deleted). */
export async function deleteCachedWeather(fileName: string): Promise<void> {
  if (!fileName) return;
  await withWriteTransaction(STORE, (store) => {
    store.delete(fileName);
  });
}
