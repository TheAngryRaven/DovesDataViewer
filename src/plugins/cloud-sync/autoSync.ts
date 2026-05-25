// Background, offline-aware document auto-sync.
//
// Runs outside React: tracks the signed-in user via the Supabase session and
// listens to host garage-change events (vehicles/setups/templates/types/notes).
//   • Online: debounce, then upsert (put) or delete the single changed record.
//   • Offline (or a failed push): the change is recorded as *pending* so it isn't
//     lost; on reconnect the pending set flushes first as priority-1 (replacing
//     the cloud state), then a timestamp-aware reconcile merges the rest.
// On sign-in it reconciles too. Only the free "documents" storage type syncs
// here; log blobs stay manual/opt-in.

import { supabase } from "@/integrations/supabase/client";
import { onGarageChange, type GarageChange } from "@/lib/garageEvents";
import { isQuotaError } from "./cloudClient";
import { deleteRecord, pushRecord, reconcileDocs } from "./syncEngine";
import { clearPending, listPending, markPending, pendingKeySet } from "./pendingSync";
import { pendingId } from "./merge";
import { storageTypeForStore } from "./storageTypes";

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
      notify(
        `Cloud ${storageTypeForStore(change.store)} storage is full — saved locally, not synced.`,
        "error",
      );
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
        notify(
          `Cloud ${storageTypeForStore(change.store)} storage is full — some changes didn't sync.`,
          "error",
        );
      }
      // otherwise leave it pending for the next reconnect
    }
  }
}

async function runReconcile(userId: string): Promise<void> {
  try {
    await flushPending(userId);
    await reconcileDocs(userId, await pendingKeySet());
  } catch (err) {
    if (isQuotaError(err)) {
      notify("Cloud document storage is full — some items didn't sync.", "error");
    } else {
      console.error("auto-sync reconcile failed", err);
    }
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
    if (currentUserId) void runReconcile(currentUserId);
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    const next = session?.user?.id ?? null;
    const newlySignedIn = next !== null && next !== currentUserId;
    currentUserId = next;
    if (newlySignedIn) void runReconcile(next);
  });

  onGarageChange(schedule);

  if (typeof window !== "undefined") {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
  }
}
