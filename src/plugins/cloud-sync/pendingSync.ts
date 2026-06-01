// Persistent "pending changes" set for offline-aware document sync.
//
// A pending entry is a local doc change (put or delete) not yet confirmed in the
// cloud — because we were offline or a push failed. On reconnect these flush
// first as priority-1 (replacing the cloud state). Stored in the plugin's own KV
// so they survive a reload while offline.

import { getPluginStore } from "@/plugins/storage";
import type { GarageChangeType } from "@/lib/garageEvents";
import { pendingId } from "./merge";
import { userScope } from "./activeUser";

export interface PendingChange {
  store: string;
  key: string;
  type: GarageChangeType;
}

const store = getPluginStore("cloud-sync");
// Per-user so one account's queued changes never flush into another's cloud.
const key = () => `pending-changes:${userScope()}`;

async function read(): Promise<PendingChange[]> {
  return (await store.get<PendingChange[]>(key())) ?? [];
}

/** Record (or update) a pending change; the latest op for a key wins. */
export async function markPending(change: PendingChange): Promise<void> {
  const list = await read();
  const i = list.findIndex((c) => c.store === change.store && c.key === change.key);
  if (i >= 0) list[i] = change;
  else list.push(change);
  await store.set(key(), list);
}

/** Drop a pending entry once it's been confirmed in the cloud. */
export async function clearPending(store_: string, key_: string): Promise<void> {
  const list = await read();
  await store.set(
    key(),
    list.filter((c) => !(c.store === store_ && c.key === key_)),
  );
}

export async function listPending(): Promise<PendingChange[]> {
  return read();
}

export async function pendingCount(): Promise<number> {
  return (await read()).length;
}

/** Set of `pendingId`s currently pending — passed to the reconcile merge. */
export async function pendingKeySet(): Promise<Set<string>> {
  return new Set((await read()).map((c) => pendingId(c.store, c.key)));
}
