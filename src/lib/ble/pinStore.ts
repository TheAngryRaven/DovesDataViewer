/**
 * Per-logger PIN memory for remote transfer (plan 0031).
 *
 * Device-local on purpose: it is never cloud-synced, and losing it costs one
 * look at the logger's Transfer → PIN page. Keyed by the Web Bluetooth
 * `device.id` (stable per origin while the browser keeps the permission) with
 * the advertised name as a fallback for when the browser hands out a fresh id.
 *
 * Every storage access is guarded: a private window or blocked site data just
 * means the user is asked again.
 */

const STORAGE_KEY = "dove-logger-pins";

type PinMap = Record<string, string>;

const idKey = (id: string) => `id:${id}`;
const nameKey = (name: string) => `name:${name}`;

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable — the PIN is simply asked for next time.
  }
}

/** The stored PIN for this logger, or null. */
export function loadLoggerPin(deviceId: string, deviceName: string): string | null {
  const map = read();
  const pin = map[idKey(deviceId)] ?? (deviceName ? map[nameKey(deviceName)] : undefined);
  return typeof pin === "string" && /^[0-9]{4}$/.test(pin) ? pin : null;
}

/** Remember the PIN for this logger. */
export function saveLoggerPin(deviceId: string, deviceName: string, pin: string): void {
  const map = read();
  map[idKey(deviceId)] = pin;
  if (deviceName) map[nameKey(deviceName)] = pin;
  write(map);
}

/** Forget this logger's PIN (it was rejected). */
export function forgetLoggerPin(deviceId: string, deviceName: string): void {
  const map = read();
  delete map[idKey(deviceId)];
  if (deviceName) delete map[nameKey(deviceName)];
  write(map);
}
