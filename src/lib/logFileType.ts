/**
 * Maps a log file's extension to a short, human-friendly label for the file
 * browser's "type" bubble. We don't persist the detected format, so the file
 * name's extension is the source of truth here. Unknown extensions fall back to
 * the uppercased extension itself; a name with no extension yields "".
 */
const EXTENSION_LABELS: Record<string, string> = {
  dove: "Dove",
  dovex: "Dovex",
  dovep: "Dovep",
  xrk: "XRK",
  xrz: "XRZ",
  ibt: "iRacing",
  vbo: "VBO",
  ld: "MoTeC",
  ubx: "UBX",
  nmea: "NMEA",
  csv: "CSV",
  txt: "TXT",
};

/** Lowercased extension (no dot), or "" when the name has none. */
export function logFileExtension(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Short type label for the browser bubble, or "" when no extension is present. */
export function logFileTypeLabel(fileName: string): string {
  const ext = logFileExtension(fileName);
  if (!ext) return "";
  return EXTENSION_LABELS[ext] ?? ext.toUpperCase();
}
