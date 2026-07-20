/**
 * Session loading for the firmware simulator's file picker (plan 0010).
 *
 * The picker is a bug-hunting tool: it must accept any dove-family log the
 * logger could have produced, including files whose metadata preamble was
 * never written (session not ended on the device) or was corrupted — as long
 * as the embedded Dove CSV column headers are intact. `parseDovexFile`
 * already discovers the embedded CSV through any preamble (full, padded,
 * corrupted, or absent — a bare Dove CSV is a zero-length preamble), so the
 * lenient path is simply: skip format auto-detection (the user asserted this
 * is a dove-family file, so there is nothing to mis-detect against) and
 * normalize channels exactly like `parseDatalogFile` does.
 */

import { normalizeChannels } from '@/lib/channels';
import { parseDovexFile } from '@/lib/dovexParser';
import type { ParsedData } from '@/types/racing';

/** File-picker accept list: every dove-family extension the logger writes. */
export const SIM_SESSION_ACCEPT = '.dovex,.dovep,.dove';

/**
 * Parse a user-supplied dove-family log for the simulator.
 * Throws when no embedded Dove CSV (its column-header row) can be found.
 */
export function parseSimSession(text: string): ParsedData {
  return normalizeChannels(parseDovexFile(text));
}
