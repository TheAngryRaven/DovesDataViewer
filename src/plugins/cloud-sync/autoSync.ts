// Background, offline-aware document auto-sync.
//
// Runs outside React: tracks the signed-in user via the Supabase session and
// listens to host garage-change events (vehicles/setups/templates/types/notes).
//   • Online: debounce, then upsert (put) or delete the single changed record.
//   • Offline (or a failed push): the change is recorded as *pending* so it isn't
//     lost; on reconnect the pending set flushes first as priority-1 (replacing
//     the cloud state), then a timestamp-aware reconcile merges the rest.
// On sign-in it reconciles too. Garage documents + lap snapshots auto-sync here;
// log blobs stay manual/opt-in. All three share one pooled per-tier byte budget.

import { supabase } from "@/integrations/supabase/client";
import { STORE_NAMES } from "@/lib/dbUtils";
import { onGarageChange, type GarageChange } from "@/lib/garageEvents";
import { isQuotaError } from "./cloudClient";
import { deleteCloudFile, deleteRecord, pushRecord, reconcileDocs } from "./syncEngine";
import { clearSnapshotTombstone, pushSnapshot, reconcileSnapshots } from "./snapshotSync";
import { addSetupRevisionTombstone, clearSetupRevisionTombstone } from "./setupRevisionTombstones";
import { clearPending, listPending, markPending, pendingKeySet } from "./pendingSync";
import { unselectFile } from "./fileSync";
import { setActiveUserId } from "./activeUser";
import { pendingId } from "./merge";
import { FILE_STORE } from "./syncStores";

const DEBOUNCE_MS = 800;

let currentUserId: string | null = null;
let started = false;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Injected so this module stays free of any toast/UI dependency. */
type Notifier = (message: string, kind: "error" | "info") => void;
let notify: Notifier = () => {};
export function setAutoSyncNotifier(fn: Notifier): void {
  notify = fn;
}

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

async function pushOne(userId: string, change: GarageChange): Promise<void> {
  if (change.store === STORE_NAMES.LAP_SNAPSHOTS) {
    // Snapshots always push on save; a local delete never propagates to the
    // cloud (the cloud copy is removed only explicitly, from the profile page).
    if (change.type === "delete") return;
    await clearSnapshotTombstone(change.key); // a fresh save re-enables cloud sync
    await pushSnapshot(userId, change.key);
    return;
  }
  if (change.store === STORE_NAMES.SETUP_REVISIONS) {
    // A delete here is the orphan prune. Don't remove the cloud copy (another
    // device may still reference it) — tombstone the id so reconcile won't
    // re-pull it locally. A fresh freeze (put) clears the tombstone + pushes.
    if (change.type === "delete") {
      await addSetupRevisionTombstone(change.key);
      return;
    }
    await clearSetupRevisionTombstone(change.key);
    await pushRecord(userId, change.store, change.key);
    return;
  }
  if (change.store === FILE_STORE) {
    // Files only ever queue here as a deferred *delete* (a log removed while
    // offline). Remove the blob + its index, and drop the stale selection.
    if (change.type === "delete") {
      await deleteCloudFile(userId, change.key);
      await unselectFile(change.key);
    }
    return;
  }
  if (change.type === "delete") await deleteRecord(userId, change.store, change.key);
  else await pushRecord(userId, change.store, change.key);
}

async function flush(change: GarageChange): Promise<void> {
  const userId = currentUserId;
  if (!userId) return;
  if (!isOnline()) {
    await markPending(change);
    return;
  }
  try {
    await pushOne(userId, change);
    await clearPending(change.store, change.key);
  } catch (err) {
    if (isQuotaError(err)) {
      notify("Cloud storage is full — saved locally, not synced. Free up space or upgrade in Profile.", "error");
    } else {
      // Network/other failure → keep it as a pending change to retry on reconnect.
      await markPending(change);
    }
  }
}

function schedule(change: GarageChange): void {
  if (!currentUserId) return; // only sync while signed in
  if (!isOnline()) {
    void markPending(change);
    return;
  }
  const key = pendingId(change.store, change.key);
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void flush(change);
    }, DEBOUNCE_MS),
  );
}

/** Push every pending change (priority-1); drop each that confirms. */
async function flushPending(userId: string): Promise<void> {
  for (const change of await listPending()) {
    try {
      await pushOne(userId, change);
      await clearPending(change.store, change.key);
    } catch (err) {
      if (isQuotaError(err)) {
        notify("Cloud storage is full — some changes didn't sync. Free up space or upgrade in Profile.", "error");
      }
      // otherwise leave it pending for the next reconnect
    }
  }
}

async function runReconcile(userId: string): Promise<void> {
  // Documents and snapshots reconcile independently: a failure in one (e.g. a
  // missing table / quota error) must not skip the other.
  try {
    await flushPending(userId);
    const { skipped } = await reconcileDocs(userId, await pendingKeySet());
    if (skipped > 0) {
      notify(
        `Cloud storage is full — ${skipped} item${skipped === 1 ? "" : "s"} didn't sync.`,
        "error",
      );
    }
  } catch (err) {
    if (isQuotaError(err)) {
      notify("Cloud storage is full — some items didn't sync.", "error");
    } else {
      console.error("auto-sync document reconcile failed", err);
    }
  }

  try {
    const snap = await reconcileSnapshots(userId);
    if (snap.skipped > 0) {
      notify(
        `Cloud storage is full — ${snap.skipped} snapshot${snap.skipped === 1 ? "" : "s"} didn't sync. Free up space or upgrade in Profile.`,
        "error",
      );
    }
  } catch (err) {
    console.error("auto-sync snapshot reconcile failed", err);
  }
}

function handleOnline(): void {
  if (currentUserId) void runReconcile(currentUserId);
}

function handleOffline(): void {
  notify("You're offline — changes are saved locally and will sync when you reconnect.", "info");
}

/** Start the background document auto-sync. Idempotent. */
export function startAutoSync(): void {
  if (started) return;
  started = true;

  void supabase.auth.getSession().then(({ data }) => {
    currentUserId = data.session?.user?.id ?? null;
    setActiveUserId(currentUserId);
    if (currentUserId) void runReconcile(currentUserId);
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    const next = session?.user?.id ?? null;
    const newlySignedIn = next !== null && next !== currentUserId;
    currentUserId = next;
    // Re-scope the plugin-local stores BEFORE any reconcile so a reconcile only
    // ever reads/writes the now-active user's partition.
    setActiveUserId(next);
    if (newlySignedIn) void runReconcile(next);
  });

  onGarageChange(schedule);

  if (typeof window !== "undefined") {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
  }
}
