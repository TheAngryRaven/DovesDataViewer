/**
 * Ownership token for the native logger connection.
 *
 * The native backend holds ONE global connection slot (`LoggerState` in the
 * Rust shell) — a second `logger_connect` silently replaces the first, which
 * would yank the device out from under whichever surface was using it. Two
 * surfaces can hold a connection: the Device tab (`DeviceContext`) and the
 * per-logger download dialogs. This module makes the collision explicit:
 * acquire before `logger_connect`, release on disconnect, and a second
 * acquirer is REFUSED (no preemption) so the UI can tell the user to
 * disconnect the other surface first.
 *
 * Web Bluetooth connections don't share this constraint (each holds its own
 * GATT link), so only the native flows consult this token.
 */

let owner: string | null = null;

/**
 * Try to claim the native connection slot for `who` (e.g. `"device-tab"`,
 * `"download"`). Returns true on success (idempotent for the same owner);
 * false if another surface holds it.
 */
export function acquireNativeConnection(who: string): boolean {
  if (owner !== null && owner !== who) return false;
  owner = who;
  return true;
}

/** Release the slot (no-op unless `who` is the current owner). */
export function releaseNativeConnection(who: string): void {
  if (owner === who) owner = null;
}

/** The current owner label, for building "disconnect X first" messages. */
export function nativeConnectionOwner(): string | null {
  return owner;
}
