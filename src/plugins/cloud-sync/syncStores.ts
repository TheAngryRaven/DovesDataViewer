// Pure config for which IndexedDB stores sync and how their records are keyed.
// Kept free of the Supabase client (and thus of browser-only globals) so it
// stays unit-testable in a node environment.

import { STORE_NAMES } from "@/lib/dbUtils";
import { TRACKS_SYNC_STORE } from "@/lib/trackStorage";

/** Key path for each syncable store (IndexedDB stores + the localStorage tracks). */
const KEY_FIELD: Record<string, string> = {
  [STORE_NAMES.METADATA]: "fileName",
  [STORE_NAMES.KARTS]: "id",
  [STORE_NAMES.NOTES]: "id",
  [STORE_NAMES.SETUPS]: "id",
  [STORE_NAMES.GRAPH_PREFS]: "sessionFileName",
  // Setups are template-driven, so their vehicle types + templates must travel
  // with them or pulled setups can't render.
  [STORE_NAMES.VEHICLE_TYPES]: "id",
  [STORE_NAMES.SETUP_TEMPLATES]: "id",
  [STORE_NAMES.ENGINES]: "id",
  // Immutable, content-addressed setup history (id = content hash). Travels with
  // the setups so a session's frozen setup is available on every device.
  [STORE_NAMES.SETUP_REVISIONS]: "id",
  [TRACKS_SYNC_STORE]: "name", // user tracks (localStorage, via a store accessor)
  [STORE_NAMES.FILES]: "name",
};

/** Structured stores synced as jsonb documents. */
export const DOC_STORES = [
  STORE_NAMES.METADATA,
  STORE_NAMES.KARTS,
  STORE_NAMES.NOTES,
  STORE_NAMES.SETUPS,
  STORE_NAMES.GRAPH_PREFS,
  STORE_NAMES.VEHICLE_TYPES,
  STORE_NAMES.SETUP_TEMPLATES,
  STORE_NAMES.ENGINES,
  STORE_NAMES.SETUP_REVISIONS,
  TRACKS_SYNC_STORE,
] as const;

/** Store whose payload is a Blob, synced through the Storage bucket. */
export const FILE_STORE = STORE_NAMES.FILES;

/** Extract the cloud record_key for a store's record using its IndexedDB key path. */
export function extractKey(store: string, record: Record<string, unknown>): string {
  const field = KEY_FIELD[store];
  return String(record?.[field]);
}
