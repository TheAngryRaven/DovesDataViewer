/**
 * The camera Wi-Fi name prefix the Insta360 dialog remembers between
 * connects (plan 0025). An empty field means "the Wi-Fi this phone is already
 * on", which a placeholder made look like a default; the field now starts
 * filled with a real one instead.
 */

const KEY = "insta360.ssidPrefix";

/** X-series hotspots are named "X4 1A2B3C.OSC" and the like. */
export const DEFAULT_SSID_PREFIX = "X4";

/** The last prefix used, or the default. Storage may be unavailable. */
export function loadSsidPrefix(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): string {
  try {
    return storage?.getItem(KEY) ?? DEFAULT_SSID_PREFIX;
  } catch {
    return DEFAULT_SSID_PREFIX;
  }
}

/** Remember `prefix` (trimmed; an empty one is remembered as empty). */
export function saveSsidPrefix(prefix: string, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, prefix.trim());
  } catch {
    // Private mode or storage disabled: just don't remember it.
  }
}
