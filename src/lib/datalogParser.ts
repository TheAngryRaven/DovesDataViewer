import { ParsedData } from '@/types/racing';
import { parseDatalog } from './nmeaParser';
import { parseUbxFile, isUbxFormat } from './ubxParser';
import { parseVboFile, isVboFormat } from './vboParser';
import { parseDoveFile, isDoveFormat } from './doveParser';
import { parseAlfanoFile, isAlfanoFormat } from './alfanoParser';
import { parseAimFile, isAimFormat } from './aimParser';
import { isMotecLdFormat, parseMotecLdFile, isMotecCsvFormat, parseMotecCsvFile } from './motecParser';

/**
 * Unified datalog parser that auto-detects format and routes to appropriate parser.
 * Supports:
 * - MoTeC LD binary format (MoTeC data loggers, sim racing exports)
 * - UBX binary format (u-blox GPS receivers)
 * - VBO format (Racelogic VBOX, RaceBox exports)
 * - MoTeC CSV format (i2 Pro exports)
 * - Dove CSV format (simple CSV with Unix timestamps)
 * - Alfano CSV format (Alfano data loggers)
 * - AiM CSV format (MyChron 5/6, Race Studio 3 exports)
 * - NMEA text format (CSV with NMEA sentences, .nmea files)
 */
export async function parseDatalogFile(file: File): Promise<ParsedData> {
  const buffer = await file.arrayBuffer();
  
  // Check MoTeC LD binary format first (different magic bytes from UBX)
  if (isMotecLdFormat(buffer)) {
    return parseMotecLdFile(buffer);
  }
  
  // Check if it's UBX binary format
  if (isUbxFormat(buffer)) {
    return parseUbxFile(buffer);
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
  
  // Check if it's Dove CSV format
  if (isDoveFormat(text)) {
    return parseDoveFile(text);
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

/**
 * Parse from raw content (for when you already have the data loaded)
 */
export function parseDatalogContent(content: string | ArrayBuffer): ParsedData {
  if (content instanceof ArrayBuffer) {
    if (isMotecLdFormat(content)) {
      return parseMotecLdFile(content);
    }
    if (isUbxFormat(content)) {
      return parseUbxFile(content);
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
    
    if (isDoveFormat(text)) {
      return parseDoveFile(text);
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
  
  if (isDoveFormat(content)) {
    return parseDoveFile(content);
  }
  
  if (isAlfanoFormat(content)) {
    return parseAlfanoFile(content);
  }
  
  if (isAimFormat(content)) {
    return parseAimFile(content);
  }
  
  return parseDatalog(content);
}
