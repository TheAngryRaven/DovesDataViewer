import { ParsedData } from '@/types/racing';
import { normalizeChannels } from './channels';
import { parseDatalog } from './nmeaParser';
import { parseUbxFile, isUbxFormat } from './ubxParser';
import { parseVboFile, isVboFormat } from './vboParser';
import { parseDoveFile, isDoveFormat } from './doveParser';
import { parseDovexFile, isDovexFormat } from './dovexParser';
import { parseAlfanoFile, isAlfanoFormat } from './alfanoParser';
import { parseAimFile, isAimFormat, hasAimSignature } from './aimParser';
import { isMotecLdFormat, parseMotecLdFile, isMotecCsvFormat, parseMotecCsvFile } from './motecParser';
import { isIracingFormat, parseIracingFile } from './iracingParser';
import { isXrkFile, parseXrkFile, type XrkProgressCallback } from './xrk/xrkImporter';
import { beginFileLoading, updateFileLoading, endFileLoading } from './fileLoadingState';

/**
 * Unified datalog parser that auto-detects format and routes to appropriate parser.
 * Supports:
 * - MoTeC LD binary format (MoTeC data loggers, sim racing exports)
 * - UBX binary format (u-blox GPS receivers)
 * - iRacing .ibt binary telemetry (the sim's native on-disk export)
 * - VBO format (Racelogic VBOX, RaceBox exports)
 * - MoTeC CSV format (i2 Pro exports)
 * - Dovex format (DovesDataLogger extended with metadata header)
 * - Dove CSV format (simple CSV with Unix timestamps)
 * - Alfano CSV format (Alfano data loggers)
 * - AiM CSV format (MyChron 5/6, Race Studio 3 exports)
 * - AiM XRK/XRZ binary format (MyChron/SoloDL — parsed in-browser via libxrk wasm)
 * - NMEA text format (CSV with NMEA sentences, .nmea files)
 *
 * `onProgress` only fires for the async, worker-backed XRK path (wasm load +
 * parse); every other format parses synchronously and ignores it.
 *
 * Brackets the whole load with the `fileLoadingState` overlay so every "open a
 * file as the session" path (import, file-manager reopen, cloud open) dims the
 * screen while it works. Fast formats finish in the same tick (overlay never
 * paints); the slow XRK path streams its phase messages into the overlay.
 */
export async function parseDatalogFile(
  file: File,
  onProgress?: XrkProgressCallback,
): Promise<ParsedData> {
  beginFileLoading("Loading telemetry…");
  try {
    return normalizeChannels(
      await routeDatalogFile(file, (progress) => {
        updateFileLoading(progress.message);
        onProgress?.(progress);
      }),
    );
  } finally {
    endFileLoading();
  }
}

/**
 * Parse from raw content (for when you already have the data loaded).
 */
export function parseDatalogContent(content: string | ArrayBuffer): ParsedData {
  return normalizeChannels(routeDatalogContent(content));
}

async function routeDatalogFile(
  file: File,
  onProgress?: XrkProgressCallback,
): Promise<ParsedData> {
  const buffer = await file.arrayBuffer();

  // AiM XRK/XRZ binary — detected by extension or `<h` magic. Parsed in a
  // wasm worker (libxrk), so this branch is async + the only one with progress.
  if (isXrkFile(file.name, buffer)) {
    return parseXrkFile(file, onProgress);
  }

  // Check MoTeC LD binary format first (different magic bytes from UBX)
  if (isMotecLdFormat(buffer)) {
    return parseMotecLdFile(buffer);
  }

  // Check if it's UBX binary format
  if (isUbxFormat(buffer)) {
    return parseUbxFile(buffer);
  }

  // Check if it's iRacing .ibt binary telemetry (validated by header + YAML probe)
  if (isIracingFormat(buffer)) {
    return parseIracingFile(buffer);
  }

  // For text formats, read as string
  const text = await file.text();
  
  // Check if it's VBO format
  if (isVboFormat(text)) {
    return parseVboFile(text);
  }
  
  // Check if it's MoTeC CSV format (before Dove/Alfano/AiM since it's more specific)
  if (isMotecCsvFormat(text)) {
    return parseMotecCsvFile(text);
  }
  
  // Check if it's Dovex format (before Dove since it contains Dove data)
  if (isDovexFormat(text)) {
    return parseDovexFile(text);
  }
  
  // Check if it's Dove CSV format
  if (isDoveFormat(text)) {
    return parseDoveFile(text);
  }

  // AiM RaceStudio CSV carries an unambiguous "AiM CSV File" signature. Claim it
  // before Alfano, whose loose header match (rpm/water) would otherwise grab it
  // and then fail to parse the AiM layout.
  if (hasAimSignature(text) && isAimFormat(text)) {
    return parseAimFile(text);
  }

  // Check if it's Alfano CSV format
  if (isAlfanoFormat(text)) {
    return parseAlfanoFile(text);
  }

  // Check if it's AiM CSV format (MyChron, Race Studio 3)
  if (isAimFormat(text)) {
    return parseAimFile(text);
  }

  // Otherwise, treat as NMEA text format
  return parseDatalog(text);
}

function routeDatalogContent(content: string | ArrayBuffer): ParsedData {
  if (content instanceof ArrayBuffer) {
    // AiM XRK needs the async, worker-backed importer (wasm). This sync entry
    // point can't run it, so fail clearly rather than mis-detecting the binary as
    // a text format. In practice nothing reaches here with XRK — every "load a
    // file" path (session, reference, overlay) uses async parseDatalogFile; the
    // remaining sync callers (BLE download, bundled sample) are never XRK.
    if (isXrkFile("", content)) {
      throw new Error("AiM .xrk/.xrz files must be parsed via parseDatalogFile (async).");
    }
    if (isMotecLdFormat(content)) {
      return parseMotecLdFile(content);
    }
    if (isUbxFormat(content)) {
      return parseUbxFile(content);
    }
    if (isIracingFormat(content)) {
      return parseIracingFile(content);
    }
    // Convert to text for text-based format detection
    const decoder = new TextDecoder();
    const text = decoder.decode(content);
    
    if (isVboFormat(text)) {
      return parseVboFile(text);
    }
    
    if (isMotecCsvFormat(text)) {
      return parseMotecCsvFile(text);
    }
    
    if (isDovexFormat(text)) {
      return parseDovexFile(text);
    }
    
    if (isDoveFormat(text)) {
      return parseDoveFile(text);
    }

    if (hasAimSignature(text) && isAimFormat(text)) {
      return parseAimFile(text);
    }

    if (isAlfanoFormat(text)) {
      return parseAlfanoFile(text);
    }

    if (isAimFormat(text)) {
      return parseAimFile(text);
    }

    return parseDatalog(text);
  }

  // String content
  if (isVboFormat(content)) {
    return parseVboFile(content);
  }

  if (isMotecCsvFormat(content)) {
    return parseMotecCsvFile(content);
  }

  if (isDovexFormat(content)) {
    return parseDovexFile(content);
  }

  if (isDoveFormat(content)) {
    return parseDoveFile(content);
  }

  if (hasAimSignature(content) && isAimFormat(content)) {
    return parseAimFile(content);
  }

  if (isAlfanoFormat(content)) {
    return parseAlfanoFile(content);
  }

  if (isAimFormat(content)) {
    return parseAimFile(content);
  }

  return parseDatalog(content);
}
