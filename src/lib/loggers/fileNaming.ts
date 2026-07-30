/**
 * Pure filename normalization for the native download flows. Devices report
 * their own session names (MyChron: `a_0217.xrz`; Alfano: a bare hex id), but
 * the importer routes by extension, so downloads are saved/imported under a
 * name whose extension matches the bytes the backend hands back.
 */

/**
 * Name for a downloaded MyChron session. The backend inflates the device's
 * compressed `.xrz` server-side, so the bytes are already XRK — swap a trailing
 * `.xrz` for `.xrk` (never `a_0217.xrz.xrk`) and leave `.xrk` names alone.
 */
export function xrkFileName(deviceName: string): string {
  const lower = deviceName.toLowerCase();
  if (lower.endsWith(".xrk")) return deviceName;
  const base = lower.endsWith(".xrz") ? deviceName.slice(0, -".xrz".length) : deviceName;
  return `${base}.xrk`;
}

/**
 * Name for a downloaded Alfano session. The device reports bare session ids
 * with no extension, but the payload is CSV — append `.csv` so the importer
 * routes it (and the saved file opens) correctly.
 */
export function csvFileName(deviceName: string): string {
  return deviceName.toLowerCase().endsWith(".csv") ? deviceName : `${deviceName}.csv`;
}
