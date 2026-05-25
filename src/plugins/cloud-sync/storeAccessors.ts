// Per-store read/get/put accessors for the document sync engine.
//
// Most syncable stores live in IndexedDB and share one accessor. Tracks live in
// localStorage (trackStorage), so they get their own accessor backed by the
// user-track helpers. This is the seam that lets non-IDB data sync through the
// same engine — `reconcileDocs` / `pushRecord` / `writeOne` go through here
// instead of assuming IndexedDB.

import { withReadTransaction, withWriteTransaction } from "@/lib/dbUtils";
import type { Track } from "@/types/racing";
import {
  TRACKS_SYNC_STORE,
  getUserTrack,
  listUserTracks,
  putUserTrackRaw,
} from "@/lib/trackStorage";

type Record_ = Record<string, unknown>;

export interface StoreAccessor {
  readAll(): Promise<Record_[]>;
  getOne(key: string): Promise<Record_ | undefined>;
  /** Raw write — must NOT emit a garage event or re-stamp (it's the pull path). */
  putOne(record: Record_): Promise<void>;
}

function idbAccessor(store: string): StoreAccessor {
  return {
    readAll: () => withReadTransaction<Record_[]>(store, (s) => s.getAll()),
    getOne: (key) => withReadTransaction<Record_ | undefined>(store, (s) => s.get(key)),
    putOne: (record) => withWriteTransaction(store, (s) => s.put(record)),
  };
}

const tracksAccessor: StoreAccessor = {
  readAll: async () => listUserTracks() as unknown as Record_[],
  getOne: async (key) => getUserTrack(key) as unknown as Record_ | undefined,
  putOne: async (record) => putUserTrackRaw(record as unknown as Track),
};

const overrides: Record<string, StoreAccessor> = {
  [TRACKS_SYNC_STORE]: tracksAccessor,
};

const idbCache = new Map<string, StoreAccessor>();

/** The accessor for a sync store (localStorage-backed for tracks, else IndexedDB). */
export function getAccessor(store: string): StoreAccessor {
  const override = overrides[store];
  if (override) return override;
  let accessor = idbCache.get(store);
  if (!accessor) {
    accessor = idbAccessor(store);
    idbCache.set(store, accessor);
  }
  return accessor;
}
