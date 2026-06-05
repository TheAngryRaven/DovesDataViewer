/**
 * Esri satellite imagery sources.
 *
 * The default Esri "World Imagery" basemap is a single best-available mosaic —
 * there is no time control, so whatever clouds (or seasonal cover) were in that
 * capture are baked in. Esri's *Wayback* service exposes every historical
 * release of World Imagery indexed by publish date, letting a user step back to
 * a different — e.g. cloud-free — version of the same area. Online-only, like
 * all satellite tiles (offline-first exception #1).
 */

/** Current best-available Esri World Imagery (the default, time-less mosaic). */
export const DEFAULT_SATELLITE_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/** Esri Wayback release index (maps each releaseNum → title/date + tile URL). */
export const WAYBACK_CONFIG_URL =
  'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';

export interface WaybackRelease {
  /** Esri release number (the {releaseNum} baked into the tile URL). */
  releaseNum: number;
  /** ISO publish date (YYYY-MM-DD) of the imagery release. */
  date: string;
  /** Leaflet-ready tile URL template ({z}/{y}/{x}). */
  tileUrl: string;
}

interface RawWaybackEntry {
  itemTitle?: string;
  itemURL?: string;
}

const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

/**
 * Convert an Esri WMTS template ({level}/{row}/{col}) to the Leaflet placeholder
 * scheme ({z}/{y}/{x}). Esri's row/col map directly to Leaflet's y/x.
 */
export function waybackToLeafletUrl(itemURL: string): string {
  return itemURL
    .replace('{level}', '{z}')
    .replace('{row}', '{y}')
    .replace('{col}', '{x}');
}

/**
 * Parse the raw waybackconfig.json into a date-sorted (newest first) list of
 * releases. Entries without a parseable date or tile URL are skipped.
 */
export function parseWaybackConfig(
  raw: Record<string, RawWaybackEntry>,
): WaybackRelease[] {
  const releases: WaybackRelease[] = [];
  for (const [key, entry] of Object.entries(raw)) {
    const releaseNum = Number(key);
    if (!Number.isFinite(releaseNum) || !entry?.itemURL) continue;
    const date = entry.itemTitle?.match(DATE_RE)?.[1];
    if (!date) continue;
    releases.push({
      releaseNum,
      date,
      tileUrl: waybackToLeafletUrl(entry.itemURL),
    });
  }
  // Newest first — ISO dates sort lexicographically.
  releases.sort((a, b) => b.date.localeCompare(a.date));
  return releases;
}

let cache: Promise<WaybackRelease[]> | null = null;

/**
 * Fetch + parse the Wayback release list, memoised for the page session so the
 * (large) config is only pulled once. A failed fetch clears the cache so a
 * later call can retry.
 */
export function fetchWaybackReleases(): Promise<WaybackRelease[]> {
  if (!cache) {
    cache = fetch(WAYBACK_CONFIG_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Wayback config ${res.status}`);
        return res.json();
      })
      .then((raw) => parseWaybackConfig(raw as Record<string, RawWaybackEntry>))
      .catch((err) => {
        cache = null; // allow retry on next call
        throw err;
      });
  }
  return cache;
}
