/**
 * Bundled sample log handling.
 *
 * The sample is treated as an ordinary user file: it's seeded into IndexedDB
 * (blob + metadata) so it appears in the file browser and opens through the
 * normal file-load path — no special-case loader, no edge cases. The home-screen
 * "Load sample data" button just ensures it's seeded and opens it like any other
 * log; the "show sample files" setting controls its visibility in the browser.
 */

import { getFile, saveFile, getFileMetadata, updateFileMetadata } from "./fileStorage";

/** The sample log's stable IndexedDB key (and bundled asset file name). */
export const SAMPLE_FILE_NAME = "okc-tillotson-data.dovex";
/** Fixed browser label for the sample, instead of the date/time derived name. */
export const SAMPLE_DISPLAY_NAME = "SAMPLE - Tillotson 225rs";

const SAMPLE_URL = `/samples/${SAMPLE_FILE_NAME}`;
const SAMPLE_TRACK = "Orlando Kart Center";
const SAMPLE_COURSE = "Normal";

/** True when a file name belongs to a bundled sample log. */
export function isSampleFileName(name: string): boolean {
  return name === SAMPLE_FILE_NAME;
}

/**
 * Ensure the bundled sample log exists in IndexedDB as a real file (blob +
 * metadata), so it shows up in the browser and opens like any other log.
 *
 * Idempotent: fetches/saves the blob only when missing, and (re)tags the
 * metadata with the sample's track/course, fixed display name, and `isSample`
 * flag. The metadata write is a merge, so a later auto-detect (start time,
 * fastest lap) on open isn't clobbered — and re-running this never undoes it.
 *
 * Returns the sample's blob (existing or freshly fetched), or null on failure.
 */
export async function ensureSampleFile(): Promise<Blob | null> {
  try {
    let blob = await getFile(SAMPLE_FILE_NAME);
    if (!blob) {
      const res = await fetch(SAMPLE_URL);
      if (!res.ok) throw new Error(`fetch ${SAMPLE_URL} failed: ${res.status}`);
      blob = await res.blob();
      await saveFile(SAMPLE_FILE_NAME, blob);
    }
    const meta = await getFileMetadata(SAMPLE_FILE_NAME);
    if (!meta?.isSample || meta.displayName !== SAMPLE_DISPLAY_NAME) {
      await updateFileMetadata(SAMPLE_FILE_NAME, {
        trackName: SAMPLE_TRACK,
        courseName: SAMPLE_COURSE,
        displayName: SAMPLE_DISPLAY_NAME,
        isSample: true,
      });
    }
    return blob;
  } catch (e) {
    console.warn("Failed to seed sample file:", e);
    return null;
  }
}
