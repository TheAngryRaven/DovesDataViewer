import { ParsedData, DovexMetadata } from '@/types/racing';
import { parseDoveFile, isDoveFormat } from './doveParser';

/**
 * .dovex Parser
 *
 * Extended Dove format with a metadata preamble followed by standard .dove CSV.
 * Preamble usually includes:
 *   Line 1: session metadata column names (datetime,driver,course,short_name,best_lap_ms,optimal_ms)
 *   Line 2: session metadata values
 *   Line 3: lap data column names (lap_times_ms / laps_ms)
 *   Line 4: lap data values (comma-separated ms values)
 * Legacy files use fixed 8192-byte preambles; newer files may use variable-length padding.
 *
 * GPS logs should always be valid even if the metadata header is corrupted.
 */

const LEGACY_HEADER_SIZE = 8192;

/**
 * Find where embedded Dove CSV starts inside a .dovex payload.
 * Supports:
 * - Legacy fixed 8192-byte header
 * - New variable-length metadata preamble with padding/newlines
 */
function findDoveCsvStart(content: string): number {
  const lower = content.toLowerCase();
  let searchFrom = 0;

  // Prefer explicit Dove header discovery (robust to variable preamble size)
  while (searchFrom < lower.length) {
    const timestampIdx = lower.indexOf('timestamp', searchFrom);
    if (timestampIdx === -1) break;

    const lineStart = lower.lastIndexOf('\n', timestampIdx);
    const candidateStart = lineStart === -1 ? 0 : lineStart + 1;
    const candidate = content.substring(candidateStart).replace(/^\u0000+/, '');

    if (isDoveFormat(candidate)) {
      return candidateStart;
    }

    searchFrom = timestampIdx + 'timestamp'.length;
  }

  // Backward-compat fallback for original fixed-size preamble
  if (content.length >= LEGACY_HEADER_SIZE + 50) {
    const legacyCandidate = content.substring(LEGACY_HEADER_SIZE).replace(/^\u0000+/, '');
    if (isDoveFormat(legacyCandidate)) {
      return LEGACY_HEADER_SIZE;
    }
  }

  return -1;
}

/**
 * Check if content is .dovex format.
 * Requires metadata signature on line 1 and a valid embedded Dove CSV payload.
 */
export function isDovexFormat(content: string): boolean {
  if (content.length < 100) return false;

  const firstLine = (content.match(/^[^\r\n]*/) || [''])[0].toLowerCase().trim();
  if (!firstLine.includes('datetime') || !firstLine.includes('driver') || !firstLine.includes('course')) {
    return false;
  }

  return findDoveCsvStart(content) !== -1;
}

/**
 * Check if an ArrayBuffer is .dovex format.
 */
export function isDovexFormatBuffer(buffer: ArrayBuffer): boolean {
  const decoder = new TextDecoder();
  const text = decoder.decode(buffer);
  return isDovexFormat(text);
}

/**
 * Parse metadata header from the preamble section before Dove CSV starts.
 */
function parseMetadataHeader(headerText: string): DovexMetadata {
  const meta: DovexMetadata = {};
  const lines = headerText.split(/\r?\n/).filter(l => l.trim());

  if (lines.length < 2) return meta;

  // Lines 1-2: session metadata (header row + values row)
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const values = lines[1].split(',').map(v => v.trim());

  const headerMap: Record<string, string> = {};
  headers.forEach((h, i) => {
    if (i < values.length) headerMap[h] = values[i];
  });

  meta.datetime = headerMap['datetime'] || undefined;
  meta.driver = headerMap['driver'] || undefined;
  meta.course = headerMap['course'] || undefined;
  meta.shortName = headerMap['short_name'] || undefined;

  if (headerMap['best_lap_ms']) {
    const v = parseInt(headerMap['best_lap_ms'], 10);
    if (!isNaN(v)) meta.bestLapMs = v;
  }
  if (headerMap['optimal_ms']) {
    const v = parseInt(headerMap['optimal_ms'], 10);
    if (!isNaN(v)) meta.optimalMs = v;
  }

  // Lines 3-4: lap data (header row + values row)
  // Line 3 is typically "lap_times_ms" or "laps_ms", line 4 is comma-separated lap times
  if (lines.length >= 4) {
    const lapValues = lines[3].split(',').map(v => parseInt(v.trim(), 10)).filter(v => !isNaN(v) && v > 0);
    if (lapValues.length > 0) {
      meta.lapTimesMs = lapValues;
    }
  } else if (lines.length >= 3) {
    // Fallback: try line 3 directly as lap values (backward compat)
    const lapValues = lines[2].split(',').map(v => parseInt(v.trim(), 10)).filter(v => !isNaN(v) && v > 0);
    if (lapValues.length > 0) {
      meta.lapTimesMs = lapValues;
    }
  }

  return meta;
}

/**
 * Parse a .dovex file content string.
 */
export function parseDovexFile(content: string): ParsedData {
  const csvStart = findDoveCsvStart(content);
  if (csvStart === -1) {
    throw new Error('Invalid .dovex file: embedded Dove CSV not found');
  }

  const headerText = content.substring(0, csvStart);
  const csvContent = content.substring(csvStart).replace(/^\u0000+/, '');

  // Parse the GPS data using the standard Dove parser
  const parsed = parseDoveFile(csvContent);

  // Parse metadata header (best-effort, don't fail if corrupted)
  try {
    const metadata = parseMetadataHeader(headerText);
    if (Object.keys(metadata).length > 0) {
      parsed.dovexMetadata = metadata;
    }
  } catch (e) {
    console.warn('Failed to parse .dovex metadata header:', e);
  }

  return parsed;
}
