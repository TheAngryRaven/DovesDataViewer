// Background document auto-sync.
//
// Runs outside React: tracks the signed-in user via the Supabase auth session
// and listens to host garage-change events (vehicles/setups/templates/types/
// notes). On a change it debounces, then upserts (put) or deletes (delete) the
// single cloud record — so edits propagate up and deletes propagate everywhere.
// On sign-in it reconciles (pull cloud docs down, push local docs up). Only the
// free "documents" storage type auto-syncs here; log blobs stay manual/opt-in.

import { supabase } from "@/integrations/supabase/client";
import { onGarageChange, type GarageChange } from "@/lib/garageEvents";
import { isQuotaError } from "./cloudClient";
import { deleteRecord, pullDocs, pushDocs, pushRecord } from "./syncEngine";
import { storageTypeForStore } from "./storageTypes";

const DEBOUNCE_MS = 800;

let currentUserId: string | null = null;
let started = false;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Injected so this module stays free of any toast/UI dependency. */
type Notifier = (message: string, kind: "error" | "info") => void;
let notify: Notifier = () => {};
export function setAutoSyncNotifier(fn: Notifier): void {
  notify = fn;
}

function recordKey(change: GarageChange): string {
  return `${change.store}:${change.key}`;
}

async function flush(change: GarageChange): Promise<void> {
  const userId = currentUserId;
  if (!userId) return;
  try {
    if (change.type === "delete") {
      await deleteRecord(userId, change.store, change.key);
    } else {
      await pushRecord(userId, change.store, change.key);
    }
  } catch (err) {
    if (isQuotaError(err)) {
      notify(
        `Cloud ${storageTypeForStore(change.store)} storage is full — saved locally, not synced.`,
        "error",
      );
    } else {
      console.error("auto-sync failed", err);
    }
  }
}

function schedule(change: GarageChange): void {
  if (!currentUserId) return; // only sync while signed in
  const key = recordKey(change);
  const existing = pending.get(key);
  if (existing) clearTimeout(existing);
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      void flush(change);
    }, DEBOUNCE_MS),
  );
}

async function reconcile(userId: string): Promise<void> {
  try {
    await pullDocs(userId); // cloud → local
    await pushDocs(userId); // local-only → cloud (additive)
  } catch (err) {
    if (isQuotaError(err)) {
      notify("Cloud document storage is full — some items didn't sync.", "error");
    } else {
      console.error("auto-sync reconcile failed", err);
    }
  }
}

/** Start the background document auto-sync. Idempotent. */
export function startAutoSync(): void {
  if (started) return;
  started = true;

  void supabase.auth.getSession().then(({ data }) => {
    currentUserId = data.session?.user?.id ?? null;
    if (currentUserId) void reconcile(currentUserId);
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    const next = session?.user?.id ?? null;
    const newlySignedIn = next !== null && next !== currentUserId;
    currentUserId = next;
    if (newlySignedIn) void reconcile(next);
  });

  onGarageChange(schedule);
}
