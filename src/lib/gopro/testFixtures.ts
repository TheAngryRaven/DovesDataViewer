/**
 * Synthetic GoPro MP4 + GPMF builders for the gopro/* unit tests. They write
 * the exact byte layouts the readers decode (big-endian KLV, ISO-BMFF boxes),
 * so the tests exercise real framing rather than mocked parse results.
 */

// ─── byte helpers ────────────────────────────────────────────────────────────

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.byteLength; }
  return out;
}

export function u32(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v >>> 0));
  return out;
}

export function ascii(text: string): Uint8Array {
  return new Uint8Array([...text].map((c) => c.charCodeAt(0)));
}

// ─── GPMF ────────────────────────────────────────────────────────────────────

const SCALAR_SIZE: Record<string, number> = { b: 1, B: 1, s: 2, S: 2, l: 4, L: 4, f: 4, d: 8, j: 8, J: 8, q: 4, Q: 8 };

function writeScalar(view: DataView, offset: number, type: string, value: number): void {
  switch (type) {
    case "b": view.setInt8(offset, value); break;
    case "B": view.setUint8(offset, value); break;
    case "s": view.setInt16(offset, value); break;
    case "S": view.setUint16(offset, value); break;
    case "l": view.setInt32(offset, value); break;
    case "L": view.setUint32(offset, value); break;
    case "f": view.setFloat32(offset, value); break;
    case "d": view.setFloat64(offset, value); break;
    case "j": view.setBigInt64(offset, BigInt(value)); break;
    case "J": view.setBigUint64(offset, BigInt(value)); break;
    case "q": view.setInt32(offset, Math.round(value * 65536)); break;
    case "Q": view.setBigInt64(offset, BigInt(Math.round(value * 4294967296))); break;
    default: throw new Error(`fixture: unsupported type ${type}`);
  }
}

/** KLV header + payload padded to 4 bytes. */
function klv(key: string, type: number, structSize: number, repeat: number, payload: Uint8Array): Uint8Array {
  const header = new Uint8Array(8);
  header.set(ascii(key), 0);
  header[4] = type;
  header[5] = structSize;
  header[6] = (repeat >> 8) & 0xff;
  header[7] = repeat & 0xff;
  const padded = new Uint8Array((payload.byteLength + 3) & ~3);
  padded.set(payload);
  return concat([header, padded]);
}

/** A numeric item: `rows` records of `type` scalars (row-major). */
export function gpmfNumbers(key: string, type: string, rows: number[][]): Uint8Array {
  const size = SCALAR_SIZE[type];
  const perRow = rows[0]?.length ?? 1;
  const payload = new Uint8Array(size * perRow * rows.length);
  const view = new DataView(payload.buffer);
  rows.forEach((row, r) => row.forEach((v, e) => writeScalar(view, (r * perRow + e) * size, type, v)));
  return klv(key, type.charCodeAt(0), size * perRow, rows.length, payload);
}

/** A `c`-typed string item (one record of `text.length` chars). */
export function gpmfString(key: string, text: string, type = "c"): Uint8Array {
  return klv(key, type.charCodeAt(0), text.length, 1, ascii(text));
}

/** A complex `?` item laid out per `typeString`. */
export function gpmfComplex(key: string, typeString: string, rows: number[][]): Uint8Array {
  const structSize = [...typeString].reduce((n, t) => n + SCALAR_SIZE[t], 0);
  const payload = new Uint8Array(structSize * rows.length);
  const view = new DataView(payload.buffer);
  rows.forEach((row, r) => {
    let offset = r * structSize;
    [...typeString].forEach((t, i) => { writeScalar(view, offset, t, row[i]); offset += SCALAR_SIZE[t]; });
  });
  return klv(key, "?".charCodeAt(0), structSize, rows.length, payload);
}

/** A nested container (type 0). */
export function gpmfNested(key: string, items: Uint8Array[]): Uint8Array {
  const body = concat(items);
  return klv(key, 0, 1, body.byteLength, body);
}

/** GPS5 fix in real units. */
export interface Gps5Fix { lat: number; lon: number; alt: number; speed2d: number; speed3d?: number }

/** A HERO5–10 style payload: DEVC → STRM{GPSU, GPSF, GPSP, SCAL, GPS5}. */
export function gps5Payload(fixes: Gps5Fix[], opts: { gpsu?: string; fix?: number; dopx100?: number; withScal?: boolean } = {}): Uint8Array {
  const scal = [10_000_000, 10_000_000, 1000, 1000, 100];
  const rows = fixes.map((f) => [
    Math.round(f.lat * scal[0]), Math.round(f.lon * scal[1]), Math.round(f.alt * scal[2]),
    Math.round(f.speed2d * scal[3]), Math.round((f.speed3d ?? f.speed2d) * scal[4]),
  ]);
  const items = [
    gpmfString("STNM", "GPS (Lat., Long., Alt., 2D speed, 3D speed)"),
    gpmfString("GPSU", opts.gpsu ?? "240615143025.500", "U"),
    gpmfNumbers("GPSF", "L", [[opts.fix ?? 3]]),
    gpmfNumbers("GPSP", "S", [[opts.dopx100 ?? 150]]),
  ];
  if (opts.withScal !== false) items.push(gpmfNumbers("SCAL", "l", scal.map((s) => [s])));
  items.push(gpmfNumbers("GPS5", "l", rows));
  return gpmfNested("DEVC", [
    gpmfNumbers("DVID", "L", [[1]]),
    gpmfString("DVNM", "Hero7 Black"),
    gpmfNested("STRM", items),
  ]);
}

export interface Gps9Fix extends Gps5Fix { utcMs: number; dop: number; fix: number }

/** A HERO11+ style payload with a GPS9 stream (per-sample time/DOP/fix). */
export function gps9Payload(fixes: Gps9Fix[]): Uint8Array {
  const scal = [10_000_000, 10_000_000, 1000, 1000, 100, 1, 1000, 100, 1];
  const epoch2000 = Date.UTC(2000, 0, 1);
  const rows = fixes.map((f) => {
    const since = f.utcMs - epoch2000;
    const days = Math.floor(since / 86_400_000);
    const secs = (since - days * 86_400_000) / 1000;
    return [
      Math.round(f.lat * scal[0]), Math.round(f.lon * scal[1]), Math.round(f.alt * scal[2]),
      Math.round(f.speed2d * scal[3]), Math.round((f.speed3d ?? f.speed2d) * scal[4]),
      days, Math.round(secs * scal[6]), Math.round(f.dop * scal[7]), f.fix,
    ];
  });
  return gpmfNested("DEVC", [
    gpmfNumbers("DVID", "L", [[1]]),
    gpmfString("DVNM", "HERO11 Black"),
    gpmfNested("STRM", [
      gpmfString("STNM", "GPS (Lat., Long., Alt., 2D, 3D, days, secs, DOP, fix)"),
      gpmfString("TYPE", "lllllllSS"),
      gpmfNumbers("SCAL", "l", scal.map((s) => [s])),
      gpmfComplex("GPS9", "lllllllSS", rows),
    ]),
  ]);
}

/** A payload with an accelerometer stream only — no GPS at all. */
export function acclOnlyPayload(): Uint8Array {
  return gpmfNested("DEVC", [
    gpmfNested("STRM", [
      gpmfString("STNM", "Accelerometer"),
      gpmfNumbers("SCAL", "s", [[418]]),
      gpmfNumbers("ACCL", "s", [[0, 0, 4180], [0, 0, 4180]]),
    ]),
  ]);
}

// ─── ISO-BMFF ────────────────────────────────────────────────────────────────

export function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  return concat([u32(8 + body.byteLength), ascii(type), body]);
}

function fullBox(type: string, ...parts: Uint8Array[]): Uint8Array {
  return box(type, u32(0), ...parts);
}

export interface Mp4Options {
  /** Telemetry payloads, one per second by default. */
  payloads: Uint8Array[];
  /** Ticks per second on the gpmd track (GoPro uses 1000). */
  timescale?: number;
  /** Per-payload durations in ticks (default: 1 s each). */
  durationsTicks?: number[];
  /** Movie duration in seconds (default: sum of payload durations). */
  movieDurationSec?: number;
  /** Epoch ms creation time written to mvhd (default: none, i.e. 0). */
  creationEpochMs?: number;
  /** Put `moov` before `mdat` (desktop-muxed style) instead of after (camera style). */
  moovFirst?: boolean;
  /** Also emit a decoy video track first. */
  withVideoTrack?: boolean;
  /** Use a 64-bit `co64` chunk table. */
  co64?: boolean;
  /** Write a uniform-size `stsz` (size + count) instead of a per-sample list. */
  uniformStsz?: { size: number; count: number };
}

/**
 * Build a minimal GoPro-like MP4: `ftyp`, an `mdat` holding the payloads back
 * to back, and a `moov` with a `gpmd` track whose sample table points at them.
 */
export function buildGoProMp4(opts: Mp4Options): ArrayBuffer {
  const timescale = opts.timescale ?? 1000;
  const durations = opts.durationsTicks ?? opts.payloads.map(() => timescale);
  const totalTicks = durations.reduce((a, b) => a + b, 0);
  const movieTimescale = 1000;
  const movieDuration = Math.round((opts.movieDurationSec ?? totalTicks / timescale) * movieTimescale);
  const creation = opts.creationEpochMs !== undefined ? Math.floor(opts.creationEpochMs / 1000) + 2_082_844_800 : 0;

  const ftyp = box("ftyp", ascii("mp41"), u32(0x200), ascii("mp41"));
  const mdatBody = concat(opts.payloads);
  const mdat = box("mdat", mdatBody);

  // Where mdat's payload lands depends on box order; resolve offsets after
  // deciding the layout (moov size is order-independent, so build it twice).
  const buildMoov = (mdatPayloadStart: number): Uint8Array => {
    const offsets: number[] = [];
    let cursor = mdatPayloadStart;
    for (const p of opts.payloads) { offsets.push(cursor); cursor += p.byteLength; }

    const stts = fullBox("stts", u32(durations.length), ...durations.map((d) => u32(1, d)));
    const stsz = opts.uniformStsz
      ? fullBox("stsz", u32(opts.uniformStsz.size), u32(opts.uniformStsz.count))
      : fullBox("stsz", u32(0), u32(opts.payloads.length), ...opts.payloads.map((p) => u32(p.byteLength)));
    const stsc = fullBox("stsc", u32(1), u32(1, 1, 1));
    const stco = opts.co64
      ? fullBox("co64", u32(offsets.length), ...offsets.map((o) => u32(0, o)))
      : fullBox("stco", u32(offsets.length), ...offsets.map((o) => u32(o)));
    const gpmdEntry = box("gpmd", new Uint8Array(6), u32(1 << 16));
    const stsd = fullBox("stsd", u32(1), gpmdEntry);
    const stbl = box("stbl", stsd, stts, stsc, stsz, stco);
    const hdlr = fullBox("hdlr", u32(0), ascii("meta"), u32(0, 0, 0), ascii("GoPro MET\0"));
    const mdhd = fullBox("mdhd", u32(creation, creation, timescale, totalTicks), u32(0));
    const gpmdTrak = box("trak", box("tkhd"), box("mdia", mdhd, hdlr, box("minf", stbl)));

    const videoTrak = box("trak", box("mdia",
      fullBox("mdhd", u32(0, 0, 30000, 0), u32(0)),
      fullBox("hdlr", u32(0), ascii("vide"), u32(0, 0, 0), ascii("GoPro AVC\0")),
      box("minf", box("stbl",
        fullBox("stsd", u32(1), box("avc1", new Uint8Array(6), u32(1 << 16))),
        fullBox("stts", u32(0)), fullBox("stsz", u32(0), u32(0)), fullBox("stsc", u32(0)), fullBox("stco", u32(0)),
      )),
    ));

    const mvhd = fullBox("mvhd", u32(creation, creation, movieTimescale, movieDuration), new Uint8Array(80));
    return box("moov", mvhd, ...(opts.withVideoTrack ? [videoTrak] : []), gpmdTrak);
  };

  const moovSize = buildMoov(0).byteLength;
  const mdatPayloadStart = opts.moovFirst ? ftyp.byteLength + moovSize + 8 : ftyp.byteLength + 8;
  const moov = buildMoov(mdatPayloadStart);
  const file = opts.moovFirst ? concat([ftyp, moov, mdat]) : concat([ftyp, mdat, moov]);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}
