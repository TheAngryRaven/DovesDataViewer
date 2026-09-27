/**
 * GPMF ("GoPro Metadata Format") decoder — the subset needed to lift GPS out
 * of a `gpmd` payload. Pure DataView code, no dependencies.
 *
 * Wire format (per GoPro's gpmf-parser spec, Apache-2.0): big-endian KLV,
 * 32-bit aligned. Each item is a 4-char key, a 1-byte type character, a
 * 1-byte structure size, a 2-byte repeat count, then `size × repeat` bytes
 * padded up to a multiple of 4. Type 0 means the value is itself nested KLV.
 * A payload is `DEVC → STRM…`, each stream carrying one channel plus its
 * modifiers (`SCAL` divisors, `GPSU`/`GPSF`/`GPSP` for GPS5, `TYPE` for the
 * complex `?` records such as GPS9). See plan 0029 for the research notes.
 */

export interface GpmfItem {
  key: string;
  /** Type character code; 0 for a nested container. */
  type: number;
  structSize: number;
  repeat: number;
  /** Absolute byte offset of the value inside the payload view. */
  dataOffset: number;
  children?: GpmfItem[];
}

const NESTED = 0;

/** Decode one KLV level. Truncated/corrupt trailing bytes end the walk quietly. */
export function parseGpmf(view: DataView, start = 0, end = view.byteLength): GpmfItem[] {
  const items: GpmfItem[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const key = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3),
    );
    const type = view.getUint8(offset + 4);
    const structSize = view.getUint8(offset + 5);
    const repeat = view.getUint16(offset + 6);
    const dataOffset = offset + 8;
    const length = structSize * repeat;
    const padded = (length + 3) & ~3;
    if (dataOffset + length > end) break;
    const item: GpmfItem = { key, type, structSize, repeat, dataOffset };
    if (type === NESTED) item.children = parseGpmf(view, dataOffset, dataOffset + length);
    items.push(item);
    offset = dataOffset + padded;
  }
  return items;
}

const TYPE_SIZES: Record<string, number> = {
  b: 1, B: 1, c: 1, d: 8, f: 4, F: 4, G: 16, j: 8, J: 8, l: 4, L: 4, q: 4, Q: 8, s: 2, S: 2, U: 16,
};

function readScalar(view: DataView, offset: number, typeChar: string): number {
  switch (typeChar) {
    case "b": return view.getInt8(offset);
    case "B": return view.getUint8(offset);
    case "s": return view.getInt16(offset);
    case "S": return view.getUint16(offset);
    case "l": return view.getInt32(offset);
    case "L": return view.getUint32(offset);
    case "f": return view.getFloat32(offset);
    case "d": return view.getFloat64(offset);
    case "j": return Number(view.getBigInt64(offset));
    case "J": return Number(view.getBigUint64(offset));
    case "q": return view.getInt32(offset) / 65536; // Q15.16
    case "Q": return Number(view.getBigInt64(offset)) / 4294967296; // Q31.32
    default: throw new Error(`GPMF: unsupported scalar type '${typeChar}'`);
  }
}

/**
 * Read a numeric item as a flat list of numbers (row-major: `repeat` records
 * of `structSize / elementSize` elements each).
 */
export function readNumbers(view: DataView, item: GpmfItem): number[] {
  const typeChar = String.fromCharCode(item.type);
  const elementSize = TYPE_SIZES[typeChar];
  if (!elementSize || typeChar === "c" || typeChar === "F" || typeChar === "G" || typeChar === "U") return [];
  const perRecord = Math.floor(item.structSize / elementSize);
  const out: number[] = [];
  for (let r = 0; r < item.repeat; r++) {
    const base = item.dataOffset + r * item.structSize;
    for (let e = 0; e < perRecord; e++) out.push(readScalar(view, base + e * elementSize, typeChar));
  }
  return out;
}

/** Read a `c`/`U` item as ASCII, dropping NUL padding. */
export function readString(view: DataView, item: GpmfItem): string {
  let s = "";
  const length = item.structSize * item.repeat;
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(item.dataOffset + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/**
 * Decode a complex (`?`) item using its stream's `TYPE` string — one type
 * character per field, e.g. GPS9's `lllllllSS`. Returns one row per record.
 */
export function readComplex(view: DataView, item: GpmfItem, typeString: string): number[][] {
  const fields = typeString.split("").filter((c) => c !== "\0");
  const rows: number[][] = [];
  for (let r = 0; r < item.repeat; r++) {
    let offset = item.dataOffset + r * item.structSize;
    const row: number[] = [];
    for (const typeChar of fields) {
      const size = TYPE_SIZES[typeChar];
      if (!size) throw new Error(`GPMF: unsupported TYPE field '${typeChar}'`);
      row.push(readScalar(view, offset, typeChar));
      offset += size;
    }
    rows.push(row);
  }
  return rows;
}

/** One GPS fix lifted from a payload, already scaled to SI units. */
export interface GpmfGpsFix {
  lat: number;
  lon: number;
  altitudeM: number;
  /** 2D ground speed, m/s. */
  speedMps: number;
  /** Dilution of precision (GoPro reports ×100; already divided here). */
  dop: number;
  /** 0 = no lock, 2 = 2D, 3 = 3D. */
  fix: number;
  /** Absolute UTC of this fix (epoch ms) when the stream carries per-sample time (GPS9). */
  utcMs?: number;
}

export interface GpmfGpsPayload {
  source: "GPS9" | "GPS5";
  fixes: GpmfGpsFix[];
  /** GPS5: UTC of the payload's first sample from `GPSU` (epoch ms). */
  utcMs?: number;
}

/** `GPSU` — `yymmddhhmmss.sss` UTC → epoch ms, or undefined when malformed. */
export function parseGpsu(text: string): number | undefined {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3}))?/.exec(text.trim());
  if (!m) return undefined;
  const ms = m[7] ? parseInt(m[7].padEnd(3, "0"), 10) : 0;
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return Date.UTC(
    2000 + parseInt(m[1], 10), month - 1, day,
    parseInt(m[4], 10), parseInt(m[5], 10), parseInt(m[6], 10), ms,
  );
}

const EPOCH_2000_MS = Date.UTC(2000, 0, 1);

function scaleOf(scal: number[] | undefined, i: number): number {
  const s = scal?.[i];
  return s && s !== 0 ? s : 1;
}

function byKey(items: GpmfItem[]): Map<string, GpmfItem> {
  const map = new Map<string, GpmfItem>();
  for (const it of items) if (!map.has(it.key)) map.set(it.key, it);
  return map;
}

function decodeGps9(view: DataView, stream: Map<string, GpmfItem>): GpmfGpsPayload | null {
  const gps9 = stream.get("GPS9");
  const typeItem = stream.get("TYPE");
  if (!gps9 || !typeItem) return null;
  const scal = stream.has("SCAL") ? readNumbers(view, stream.get("SCAL")!) : undefined;
  const rows = readComplex(view, gps9, readString(view, typeItem));
  const fixes: GpmfGpsFix[] = rows
    .filter((r) => r.length >= 9)
    .map((r) => {
      const days = r[5] / scaleOf(scal, 5);
      const secs = r[6] / scaleOf(scal, 6);
      return {
        lat: r[0] / scaleOf(scal, 0),
        lon: r[1] / scaleOf(scal, 1),
        altitudeM: r[2] / scaleOf(scal, 2),
        speedMps: r[3] / scaleOf(scal, 3),
        dop: r[7] / scaleOf(scal, 7),
        fix: r[8] / scaleOf(scal, 8),
        utcMs: EPOCH_2000_MS + days * 86_400_000 + secs * 1000,
      };
    });
  return { source: "GPS9", fixes, utcMs: fixes[0]?.utcMs };
}

function decodeGps5(view: DataView, stream: Map<string, GpmfItem>): GpmfGpsPayload | null {
  const gps5 = stream.get("GPS5");
  if (!gps5) return null;
  const scal = stream.has("SCAL") ? readNumbers(view, stream.get("SCAL")!) : undefined;
  const fixItem = stream.get("GPSF");
  const dopItem = stream.get("GPSP");
  const utcItem = stream.get("GPSU");
  // Absent modifiers are treated as "locked, unknown precision" so an odd
  // firmware that omits them still imports rather than dropping every sample.
  const fix = fixItem ? readNumbers(view, fixItem)[0] ?? 3 : 3;
  const dop = dopItem ? (readNumbers(view, dopItem)[0] ?? 0) / 100 : 0;
  const utcMs = utcItem ? parseGpsu(readString(view, utcItem)) : undefined;
  const values = readNumbers(view, gps5);
  const fixes: GpmfGpsFix[] = [];
  for (let i = 0; i + 5 <= values.length; i += 5) {
    fixes.push({
      lat: values[i] / scaleOf(scal, 0),
      lon: values[i + 1] / scaleOf(scal, 1),
      altitudeM: values[i + 2] / scaleOf(scal, 2),
      speedMps: values[i + 3] / scaleOf(scal, 3),
      dop,
      fix,
    });
  }
  return { source: "GPS5", fixes, utcMs };
}

/**
 * Pull the GPS stream out of one `gpmd` payload. Prefers GPS9 (HERO11+,
 * per-sample time/DOP/fix) over GPS5. Null when the payload has no GPS stream.
 */
export function extractGpsPayload(buffer: ArrayBuffer): GpmfGpsPayload | null {
  const view = new DataView(buffer);
  const streams: Map<string, GpmfItem>[] = [];
  for (const devc of parseGpmf(view)) {
    if (devc.key !== "DEVC" || !devc.children) continue;
    for (const strm of devc.children) {
      if (strm.key === "STRM" && strm.children) streams.push(byKey(strm.children));
    }
  }
  for (const stream of streams) {
    const gps9 = decodeGps9(view, stream);
    if (gps9) return gps9;
  }
  for (const stream of streams) {
    const gps5 = decodeGps5(view, stream);
    if (gps5) return gps5;
  }
  return null;
}
