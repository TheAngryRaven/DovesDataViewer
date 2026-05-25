// Pure conflict-resolution decision for the document auto-sync reconcile.
//
// Rules (see the cloud-sync section in CLAUDE.md):
//   1. A *pending* local change (edited offline or whose push failed) is
//      priority-1: a pending put pushes up (replacing the cloud copy); a pending
//      delete is skipped here (the delete is flushed separately, so we must not
//      resurrect it from the cloud).
//   2. Otherwise last-write-wins by the record's own `updatedAt` (the logical
//      edit time, NOT the server row time — a late-uploaded stale edit must not win).
//   3. Local-only → push (covers anon→account migration); cloud-only → pull.

export type SyncAction = "push" | "pull" | "skip";

export interface MergeInput {
  hasLocal: boolean;
  hasCloud: boolean;
  /** Record `updatedAt` (ms); 0 when unknown/absent. */
  localT: number;
  cloudT: number;
  /** A local change tracked as pending (offline or failed push). */
  pending: boolean;
}

export function decideSync(i: MergeInput): SyncAction {
  if (i.pending) return i.hasLocal ? "push" : "skip";
  if (i.hasLocal && !i.hasCloud) return "push";
  if (i.hasCloud && !i.hasLocal) return "pull";
  if (!i.hasLocal && !i.hasCloud) return "skip";
  if (i.localT > i.cloudT) return "push";
  if (i.cloudT > i.localT) return "pull";
  return "skip";
}

// Store names are fixed, space-free ids (e.g. "setup-templates"), and this
// composite is only ever compared for equality (never split), so a space
// separator is collision-safe even when record keys contain spaces.
const SEP = " ";

/** Stable id for a (store, record key) pair — the reconcile/pending set key. */
export function pendingId(store: string, key: string): string {
  return store + SEP + key;
}

/** Extract a record's logical edit time; 0 when absent. */
export function recordUpdatedAt(data: unknown): number {
  const u = (data as { updatedAt?: unknown } | null | undefined)?.updatedAt;
  return typeof u === "number" ? u : 0;
}
