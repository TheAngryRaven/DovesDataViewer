/**
 * Minimal ISO-BMFF (MP4/MOV) reader — just enough to locate a GoPro's `gpmd`
 * telemetry track and resolve its sample table to byte ranges + timing.
 *
 * Camera-written GoPro files put `moov` AFTER the multi-gigabyte `mdat`, so the
 * reader never loads the whole file: it walks the top-level boxes with tiny
 * ranged reads through a `ByteSource`, pulls in only the `moov` box (a few MB
 * at most), and hands back the telemetry sample list for the caller to fetch.
 * Pure — a `ByteSource` over an in-memory buffer makes it fully unit-testable.
 *
 * Layout reference: ISO/IEC 14496-12. Only the boxes on the path
 * `moov/trak/mdia/{mdhd,hdlr,minf/stbl/{stsd,stts,stsz,stsc,stco|co64}}` are
 * decoded; everything else is skipped by size. (Plan 0029.)
 */

/** Random-access byte reader — a `File`/`Blob` in the app, an ArrayBuffer in tests. */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<ArrayBuffer>;
}

export function blobByteSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read: (offset, length) => blob.slice(offset, offset + length).arrayBuffer(),
  };
}

export function bufferByteSource(buffer: ArrayBuffer): ByteSource {
  return {
    size: buffer.byteLength,
    read: (offset, length) => Promise.resolve(buffer.slice(offset, offset + length)),
  };
}

/** One telemetry payload's location in the file + its place on the movie timeline. */
export interface Mp4Sample {
  offset: number;
  size: number;
  /** Presentation time of the payload's first sample (seconds, movie timeline). */
  timeSec: number;
  /** How long the payload covers (seconds). */
  durationSec: number;
}

export interface GpmdTrack {
  samples: Mp4Sample[];
  /** Whole-movie duration from `mvhd` — used to offset the next chapter. */
  movieDurationSec: number;
  /** `mvhd` creation time as epoch ms, when the camera wrote one. */
  creationEpochMs?: number;
}

/** Refuse to buffer a `moov` bigger than this (a sane GoPro moov is < 10 MB). */
const MAX_MOOV_BYTES = 64 * 1024 * 1024;

/** Seconds between the MP4 epoch (1904-01-01 UTC) and the Unix epoch. */
const MP4_EPOCH_OFFSET_SEC = 2_082_844_800;

function fourcc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Byte range and type of a box whose header starts at `offset` inside `view`. */
interface BoxRef {
  type: string;
  /** Start of the box's payload (after the 8- or 16-byte header). */
  bodyStart: number;
  /** One past the last payload byte. */
  end: number;
}

function readBox(view: DataView, offset: number, limit: number): BoxRef | null {
  if (offset + 8 > limit) return null;
  let size = view.getUint32(offset);
  const type = fourcc(view, offset + 4);
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > limit) return null;
    // largesize — a telemetry-bearing box never needs the high dword, but a
    // camera mdat can exceed 4 GB, so honour it.
    size = view.getUint32(offset + 8) * 0x1_0000_0000 + view.getUint32(offset + 12);
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset;
  }
  if (size < headerSize) return null;
  return { type, bodyStart: offset + headerSize, end: Math.min(offset + size, limit) };
}

function* children(view: DataView, start: number, end: number): Generator<BoxRef> {
  let offset = start;
  while (offset < end) {
    const box = readBox(view, offset, end);
    if (!box) return;
    yield box;
    offset = box.end;
  }
}

function findChild(view: DataView, start: number, end: number, type: string): BoxRef | null {
  for (const box of children(view, start, end)) {
    if (box.type === type) return box;
  }
  return null;
}

/** True when the buffer opens with an ISO-BMFF `ftyp` box (MP4/MOV/.360). */
export function isIsoBmff(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const view = new DataView(buffer);
  return fourcc(view, 4) === "ftyp";
}

/**
 * Walk the top-level boxes with ranged reads and return the `moov` payload.
 * Null when the file isn't ISO-BMFF or carries no `moov`.
 */
async function readMoov(src: ByteSource): Promise<ArrayBuffer | null> {
  let offset = 0;
  let sawFtyp = false;
  while (offset + 8 <= src.size) {
    const header = new DataView(await src.read(offset, Math.min(16, src.size - offset)));
    const box = readBox(header, 0, src.size - offset);
    if (!box) return null;
    if (offset === 0 && box.type !== "ftyp") return null;
    if (box.type === "ftyp") sawFtyp = true;
    const boxEnd = offset + box.end;
    if (box.type === "moov" && sawFtyp) {
      const length = box.end - box.bodyStart;
      if (length > MAX_MOOV_BYTES) throw new Error("MP4 movie header is unexpectedly large");
      return src.read(offset + box.bodyStart, length);
    }
    if (boxEnd <= offset) return null; // zero-progress guard against a corrupt size
    offset = boxEnd;
  }
  return null;
}

interface SampleTable {
  sizes: number[];
  chunkOffsets: number[];
  /** `stsc` entries: [firstChunk (1-based), samplesPerChunk] */
  chunkRuns: [number, number][];
  /** `stts` entries: [sampleCount, delta] */
  timeRuns: [number, number][];
}

function readFullBoxVersion(view: DataView, bodyStart: number): number {
  return view.getUint8(bodyStart);
}

function readStsd(view: DataView, box: BoxRef): string | null {
  // FullBox header (4) + entry_count (4) + first entry: size (4) + format (4)
  if (box.bodyStart + 16 > box.end) return null;
  const entryCount = view.getUint32(box.bodyStart + 4);
  if (entryCount === 0) return null;
  return fourcc(view, box.bodyStart + 12);
}

function readTable(view: DataView, box: BoxRef, width: 1 | 2): number[] | [number, number][] {
  const count = view.getUint32(box.bodyStart + 4);
  const out: (number | [number, number])[] = [];
  let offset = box.bodyStart + 8;
  for (let i = 0; i < count && offset + 4 * width <= box.end; i++) {
    if (width === 1) {
      out.push(view.getUint32(offset));
    } else {
      out.push([view.getUint32(offset), view.getUint32(offset + 4)]);
    }
    offset += 4 * width;
  }
  return out as number[] | [number, number][];
}

function readStsz(view: DataView, box: BoxRef): number[] {
  const uniform = view.getUint32(box.bodyStart + 4);
  const count = view.getUint32(box.bodyStart + 8);
  if (uniform !== 0) return new Array<number>(count).fill(uniform);
  const sizes: number[] = [];
  let offset = box.bodyStart + 12;
  for (let i = 0; i < count && offset + 4 <= box.end; i++, offset += 4) {
    sizes.push(view.getUint32(offset));
  }
  return sizes;
}

function readStsc(view: DataView, box: BoxRef): [number, number][] {
  const count = view.getUint32(box.bodyStart + 4);
  const runs: [number, number][] = [];
  let offset = box.bodyStart + 8;
  for (let i = 0; i < count && offset + 12 <= box.end; i++, offset += 12) {
    runs.push([view.getUint32(offset), view.getUint32(offset + 4)]);
  }
  return runs;
}

function readCo64(view: DataView, box: BoxRef): number[] {
  const count = view.getUint32(box.bodyStart + 4);
  const offsets: number[] = [];
  let offset = box.bodyStart + 8;
  for (let i = 0; i < count && offset + 8 <= box.end; i++, offset += 8) {
    offsets.push(view.getUint32(offset) * 0x1_0000_0000 + view.getUint32(offset + 4));
  }
  return offsets;
}

function readStbl(view: DataView, stbl: BoxRef): { format: string | null; table: SampleTable } {
  let format: string | null = null;
  const table: SampleTable = { sizes: [], chunkOffsets: [], chunkRuns: [], timeRuns: [] };
  for (const box of children(view, stbl.bodyStart, stbl.end)) {
    switch (box.type) {
      case "stsd": format = readStsd(view, box); break;
      case "stts": table.timeRuns = readTable(view, box, 2) as [number, number][]; break;
      case "stsz": table.sizes = readStsz(view, box); break;
      case "stsc": table.chunkRuns = readStsc(view, box); break;
      case "stco": table.chunkOffsets = readTable(view, box, 1) as number[]; break;
      case "co64": table.chunkOffsets = readCo64(view, box); break;
    }
  }
  return { format, table };
}

/** `mdhd` timescale (ticks per second) for the track's media timeline. */
function readMdhdTimescale(view: DataView, mdhd: BoxRef): number {
  const version = readFullBoxVersion(view, mdhd.bodyStart);
  // v0: creation(4) modification(4) timescale(4); v1: creation(8) modification(8) timescale(4)
  return view.getUint32(mdhd.bodyStart + (version === 1 ? 20 : 12));
}

function readMvhd(view: DataView, mvhd: BoxRef): { durationSec: number; creationEpochMs?: number } {
  const version = readFullBoxVersion(view, mvhd.bodyStart);
  let creationSec: number;
  let timescale: number;
  let duration: number;
  if (version === 1) {
    creationSec = view.getUint32(mvhd.bodyStart + 4) * 0x1_0000_0000 + view.getUint32(mvhd.bodyStart + 8);
    timescale = view.getUint32(mvhd.bodyStart + 20);
    duration = view.getUint32(mvhd.bodyStart + 24) * 0x1_0000_0000 + view.getUint32(mvhd.bodyStart + 28);
  } else {
    creationSec = view.getUint32(mvhd.bodyStart + 4);
    timescale = view.getUint32(mvhd.bodyStart + 12);
    duration = view.getUint32(mvhd.bodyStart + 16);
  }
  const creationEpochMs = creationSec > MP4_EPOCH_OFFSET_SEC
    ? (creationSec - MP4_EPOCH_OFFSET_SEC) * 1000
    : undefined;
  return { durationSec: timescale > 0 ? duration / timescale : 0, creationEpochMs };
}

/** Expand a track's sample table into per-sample byte ranges + timing. */
export function resolveSamples(table: SampleTable, timescale: number): Mp4Sample[] {
  const { sizes, chunkOffsets, chunkRuns, timeRuns } = table;
  const samples: Mp4Sample[] = [];
  if (sizes.length === 0 || chunkOffsets.length === 0 || chunkRuns.length === 0 || timescale <= 0) {
    return samples;
  }

  // Per-sample durations from the stts runs (ticks).
  const durations: number[] = [];
  for (const [count, delta] of timeRuns) {
    for (let i = 0; i < count && durations.length < sizes.length; i++) durations.push(delta);
  }

  let sampleIndex = 0;
  let timeTicks = 0;
  for (let run = 0; run < chunkRuns.length && sampleIndex < sizes.length; run++) {
    const [firstChunk, perChunk] = chunkRuns[run];
    const lastChunk = run + 1 < chunkRuns.length ? chunkRuns[run + 1][0] - 1 : chunkOffsets.length;
    for (let chunk = firstChunk; chunk <= lastChunk && sampleIndex < sizes.length; chunk++) {
      let offset = chunkOffsets[chunk - 1];
      if (offset === undefined) return samples;
      for (let k = 0; k < perChunk && sampleIndex < sizes.length; k++, sampleIndex++) {
        const size = sizes[sampleIndex];
        const ticks = durations[sampleIndex] ?? durations[durations.length - 1] ?? 0;
        samples.push({
          offset,
          size,
          timeSec: timeTicks / timescale,
          durationSec: ticks / timescale,
        });
        offset += size;
        timeTicks += ticks;
      }
    }
  }
  return samples;
}

/**
 * Locate the GoPro telemetry track and resolve its payload list.
 * Returns null when the file has no `gpmd` track (not a GoPro, or GPS-less).
 */
export async function readGpmdTrack(src: ByteSource): Promise<GpmdTrack | null> {
  const moovBuffer = await readMoov(src);
  if (!moovBuffer) return null;
  const view = new DataView(moovBuffer);
  const end = moovBuffer.byteLength;

  const mvhd = findChild(view, 0, end, "mvhd");
  const movie = mvhd ? readMvhd(view, mvhd) : { durationSec: 0 };

  for (const trak of children(view, 0, end)) {
    if (trak.type !== "trak") continue;
    const mdia = findChild(view, trak.bodyStart, trak.end, "mdia");
    if (!mdia) continue;
    const minf = findChild(view, mdia.bodyStart, mdia.end, "minf");
    const stbl = minf && findChild(view, minf.bodyStart, minf.end, "stbl");
    if (!stbl) continue;
    const { format, table } = readStbl(view, stbl);
    if (format !== "gpmd") continue;
    const mdhd = findChild(view, mdia.bodyStart, mdia.end, "mdhd");
    const timescale = mdhd ? readMdhdTimescale(view, mdhd) : 0;
    return {
      samples: resolveSamples(table, timescale),
      movieDurationSec: movie.durationSec,
      creationEpochMs: movie.creationEpochMs,
    };
  }
  return null;
}

/**
 * Fetch every payload's bytes. Payloads sit ~1 s apart in `mdat` between video
 * frames, so each is its own small ranged read, issued in bounded batches.
 */
export async function readSamples(
  src: ByteSource,
  samples: Mp4Sample[],
  onProgress?: (done: number, total: number) => void,
  batchSize = 16,
): Promise<ArrayBuffer[]> {
  const out: ArrayBuffer[] = [];
  for (let i = 0; i < samples.length; i += batchSize) {
    const batch = samples.slice(i, i + batchSize);
    const buffers = await Promise.all(batch.map((s) => src.read(s.offset, s.size)));
    out.push(...buffers);
    onProgress?.(out.length, samples.length);
  }
  return out;
}
