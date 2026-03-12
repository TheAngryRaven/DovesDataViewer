import { ParsedData, DovexMetadata } from '@/types/racing';
import { parseDoveFile, isDoveFormat } from './doveParser';

/**
 * .dovex Parser
 *
 * Extended Dove format with an 8192-byte (8 KB) metadata header:
 *   Line 1: session metadata column names (datetime,driver,course,short_name,best_lap_ms,optimal_ms)
 *   Line 2: session metadata values
 *   Line 3: lap data column names (lap_times_ms)
 *   Line 4: lap data values (comma-separated ms values)
 *   Lines 5+: padding to byte 8192
 *   Byte 8192+: standard .dove CSV
 *
 * GPS logs should always be valid even if the metadata header is corrupted.
 */

const HEADER_SIZE = 8192;

/**
 * Check if content is .dovex format.
 * We check for the metadata header pattern in the first 4096 bytes
 * AND that the remainder is valid .dove CSV.
 */
export function isDovexFormat(content: string): boolean {
  if (content.length < HEADER_SIZE + 50) return false;

  const headerText = content.substring(0, HEADER_SIZE);
  const lines = headerText.split(/\r?\n/);
  if (lines.length < 2) return false;

  // First line should contain the metadata column names
  const firstLine = lines[0].toLowerCase().trim();
  if (!firstLine.includes('datetime') || !firstLine.includes('driver') || !firstLine.includes('course')) {
    return false;
  }

  // Check that the content after 4096 bytes looks like .dove CSV
  const csvContent = content.substring(HEADER_SIZE);
  return isDoveFormat(csvContent);
}

/**
 * Check if an ArrayBuffer is .dovex format.
 */
export function isDovexFormatBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < HEADER_SIZE + 50) return false;

  const decoder = new TextDecoder();
  const text = decoder.decode(buffer);
  return isDovexFormat(text);
}

/**
 * Parse metadata header from the first 4096 bytes.
 */
function parseMetadataHeader(headerText: string): DovexMetadata {
  const meta: DovexMetadata = {};
  const lines = headerText.split(/\r?\n/).filter(l => l.trim());

  if (lines.length < 2) return meta;

  // Line 1: column headers
  // Line 2: values
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

  // Line 3: lap times (comma-separated ms values)
  if (lines.length >= 3) {
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
  const headerText = content.substring(0, HEADER_SIZE);
  const csvContent = content.substring(HEADER_SIZE);

  // Parse the GPS data using the standard dove parser
  const parsed = parseDoveFile(csvContent);

  // Parse metadata header (best-effort, don't fail if corrupted)
  try {
    const metadata = parseMetadataHeader(headerText);
    if (metadata.datetime || metadata.driver || metadata.course) {
      parsed.dovexMetadata = metadata;
    }
  } catch (e) {
    console.warn('Failed to parse .dovex metadata header:', e);
  }

  return parsed;
}
