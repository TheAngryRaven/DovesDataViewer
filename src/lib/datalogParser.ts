import { ParsedData } from '@/types/racing';
import { parseDatalog } from './nmeaParser';
import { parseUbxFile, isUbxFormat } from './ubxParser';
import { parseVboFile, isVboFormat } from './vboParser';
import { parseAlfanoFile, isAlfanoFormat } from './alfanoParser';

/**
 * Unified datalog parser that auto-detects format and routes to appropriate parser.
 * Supports:
 * - UBX binary format (u-blox GPS receivers)
 * - VBO format (Racelogic VBOX, RaceBox exports)
 * - Alfano CSV format (Alfano data loggers)
 * - NMEA text format (CSV with NMEA sentences, .nmea files)
 */
export async function parseDatalogFile(file: File): Promise<ParsedData> {
  const buffer = await file.arrayBuffer();
  
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
  
  // Check if it's Alfano CSV format
  if (isAlfanoFormat(text)) {
    return parseAlfanoFile(text);
  }
  
  // Otherwise, treat as NMEA text format
  return parseDatalog(text);
}

/**
 * Parse from raw content (for when you already have the data loaded)
 */
export function parseDatalogContent(content: string | ArrayBuffer): ParsedData {
  if (content instanceof ArrayBuffer) {
    if (isUbxFormat(content)) {
      return parseUbxFile(content);
    }
    // Convert to text for VBO/Alfano/NMEA detection
    const decoder = new TextDecoder();
    const text = decoder.decode(content);
    
    if (isVboFormat(text)) {
      return parseVboFile(text);
    }
    
    if (isAlfanoFormat(text)) {
      return parseAlfanoFile(text);
    }
    
    return parseDatalog(text);
  }
  
  // String content - check VBO first, then Alfano, then NMEA
  if (isVboFormat(content)) {
    return parseVboFile(content);
  }
  
  if (isAlfanoFormat(content)) {
    return parseAlfanoFile(content);
  }
  
  return parseDatalog(content);
}
