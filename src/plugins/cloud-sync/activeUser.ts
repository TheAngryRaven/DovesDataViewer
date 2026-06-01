// The signed-in user the plugin-local sync stores belong to.
//
// Pending changes, snapshot tombstones, and per-file sync selections all live in
// this plugin's own IndexedDB (getPluginStore("cloud-sync")), which is SHARED by
// every account that signs in on this browser. Without scoping, User A's queued
// offline edits / cloud-deletion tombstones / file selections would be applied
// to User B's cloud account on the next reconcile after a sign-out/sign-in.
//
// Each of those stores keys its data with `userScope()` so it is partitioned per
// user. autoSync updates this on every auth state change BEFORE it reconciles,
// so a reconcile for User B only ever sees User B's local state.

let activeUserId: string | null = null;

/** Set the active user (null when signed out). Called by autoSync on auth change. */
export function setActiveUserId(id: string | null): void {
  activeUserId = id;
}

/** The active user's id (null when signed out). For non-React callers (file source). */
export function getActiveUserId(): string | null {
  return activeUserId;
}

/** Key suffix identifying the active user's partition ("anon" when signed out). */
export function userScope(): string {
  return activeUserId ?? "anon";
}
