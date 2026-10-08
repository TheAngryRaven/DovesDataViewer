/**
 * Per-logger PIN memory for remote transfer (plan 0031).
 *
 * Device-local on purpose: it is never cloud-synced, and losing it costs one
 * look at the logger's Transfer → PIN page. Keyed by the Web Bluetooth
 * `device.id` only (stable per origin while the browser keeps the permission).
 * There is deliberately no fallback to the advertised name: default names come
 * from a small space, so a name match could try logger B's PIN on logger A and
 * burn one of A's tries. A browser that hands out a fresh id just means asking
 * once more (or learning it again from a local start).
 *
 * Every storage access is guarded: a private window, blocked site data or a
 * malformed entry just means the user is asked again.
 */

const STORAGE_KEY = "dove-logger-pins";

type PinMap = Record<string, string>;

const idKey = (id: string) => `id:${id}`;

function read(): PinMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as PinMap) : {};
  } catch {
    return {};
  }
}

function write(map: PinMap): void {
  // Entries keyed by advertised name came from the first cut of this store;
  // they are never read, so drop them whenever the map is rewritten.
  for (const key of Object.keys(map)) {
    if (!key.startsWith("id:")) delete map[key];
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable — the PIN is simply asked for next time.
  }
}

/** The stored PIN for this logger, or null. */
export function loadLoggerPin(deviceId: string): string | null {
  const pin = read()[idKey(deviceId)];
  return typeof pin === "string" && /^[0-9]{4}$/.test(pin) ? pin : null;
}

/** Remember the PIN for this logger. */
export function saveLoggerPin(deviceId: string, pin: string): void {
  const map = read();
  map[idKey(deviceId)] = pin;
  write(map);
}

/** Forget this logger's PIN (rejected, or the logger's settings were reset). */
export function forgetLoggerPin(deviceId: string): void {
  const map = read();
  delete map[idKey(deviceId)];
  write(map);
}
