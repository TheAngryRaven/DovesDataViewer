/**
 * Pure, DOM-free logic for treating a set of video files as one continuous
 * "playlist" — the foundation of GoPro chunked-video support.
 *
 * GoPro cameras split one recording into sequential 3-5 minute MP4 files. Two
 * naming schemes exist:
 *   - Modern (HERO6+):  GHCCFFFF.MP4 / GXCCFFFF.MP4  (GH = AVC, GX = HEVC),
 *     where CC = chapter (01, 02, …) and FFFF = the shared recording number.
 *   - Legacy (HERO5-):  GOPRFFFF.MP4 (first chapter) then GPCCFFFF.MP4
 *     (continuation chapters 01, 02, …) for the same recording number FFFF.
 *
 * The app stitches these into a virtual timeline over a single <video> element:
 * an ordered list of chunks, each with its own duration and a cumulative
 * start offset, plus helpers to map between "virtual" (whole-recording) time and
 * "local" (per-chunk) time. A single file is just a 1-chunk playlist, so the
 * single-video path is a degenerate case of the same model.
 */

export type GoProEncoding = "GH" | "GX" | "GP" | "GOPR";

export interface GoProNameParts {
  encoding: GoProEncoding;
  /** Chapter order within the recording. GOPR (legacy first file) is 0. */
  chapter: number;
  /** Shared recording number — identifies which chunks belong together. */
  fileNumber: number;
}

export interface PlaylistChunk {
  name: string;
  durationSec: number;
  /** Cumulative start time of this chunk on the virtual timeline. */
  startOffsetSec: number;
}

export interface Playlist {
  chunks: PlaylistChunk[];
  totalDuration: number;
}

/** Strip any directory prefix and the file extension, upper-cased. */
function baseName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? name;
  return last.replace(/\.[^.]+$/, "").toUpperCase();
}

/**
 * Parse a GoPro chunk filename into its parts, or null if it isn't one.
 * Recognizes GHCCFFFF / GXCCFFFF (modern), GPCCFFFF (legacy continuation),
 * and GOPRFFFF (legacy first file, chapter 0). Case-insensitive; ignores the
 * directory and extension.
 */
export function parseGoProName(name: string): GoProNameParts | null {
  const base = baseName(name);

  // Modern + legacy continuation: GH/GX/GP + 2-digit chapter + 4-digit number
  const m = /^(GH|GX|GP)(\d{2})(\d{4})$/.exec(base);
  if (m) {
    return {
      encoding: m[1] as GoProEncoding,
      chapter: parseInt(m[2], 10),
      fileNumber: parseInt(m[3], 10),
    };
  }

  // Legacy first file: GOPR + 4-digit number (chapter 0)
  const legacy = /^GOPR(\d{4})$/.exec(base);
  if (legacy) {
    return { encoding: "GOPR", chapter: 0, fileNumber: parseInt(legacy[1], 10) };
  }

  return null;
}

/**
 * Order a set of selected video files into playback order.
 *
 * GoPro chunks are sorted by (recording number, chapter) so a recording's
 * chapters land in sequence regardless of selection order; any non-GoPro files
 * keep their original selection order and are appended after. All selected
 * files become one playlist — predictable for manual multi-select.
 */
export function orderVideoFiles<T extends { name: string }>(files: T[]): T[] {
  const gopro: { file: T; parts: GoProNameParts; idx: number }[] = [];
  const other: { file: T; idx: number }[] = [];

  files.forEach((file, idx) => {
    const parts = parseGoProName(file.name);
    if (parts) gopro.push({ file, parts, idx });
    else other.push({ file, idx });
  });

  gopro.sort((a, b) => {
    if (a.parts.fileNumber !== b.parts.fileNumber) {
      return a.parts.fileNumber - b.parts.fileNumber;
    }
    if (a.parts.chapter !== b.parts.chapter) {
      return a.parts.chapter - b.parts.chapter;
    }
    return a.idx - b.idx;
  });

  other.sort((a, b) => a.idx - b.idx);

  return [...gopro.map((g) => g.file), ...other.map((o) => o.file)];
}

/** Video container extensions the player can actually open. */
const VIDEO_EXTENSIONS = [".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi"];

/** True when a filename ends in a playable video extension (case-insensitive). */
export function isVideoFile(name: string): boolean {
  const lower = name.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Stable key uniting one GoPro recording's chapters. A recording's chapters
 * share the encoding family and recording number; the legacy first file (GOPR)
 * and its GP continuations belong to the same recording, so both fold into one
 * `legacy-<number>` key.
 */
function recordingKey(parts: GoProNameParts): string {
  if (parts.encoding === "GOPR" || parts.encoding === "GP") return `legacy-${parts.fileNumber}`;
  return `${parts.encoding}-${parts.fileNumber}`;
}

/** Strip any directory prefix, keeping the original case + extension for display. */
function displayName(name: string): string {
  return name.split(/[\\/]/).pop() ?? name;
}

/** One distinct recording from a selection: its ordered file(s) + a display label. */
export interface VideoRecording<T> {
  /** Stable identity for this recording within the selection. */
  key: string;
  /** Human label — the first file's name (e.g. "GH010042.MP4"). */
  label: string;
  /** The recording's files in playback order (chapters for a GoPro recording). */
  files: T[];
}

/**
 * Group a (possibly messy) multi-selection into distinct recordings.
 *
 * On mobile there's no way to filter a file picker, so a user is likely to just
 * "select all" — pulling in GoPro `.LRV`/`.THM` sidecars, photos, and *several*
 * unrelated recordings alongside the chapters they want. We can't ask the camera
 * which clips belong together, so instead we: drop anything that isn't a playable
 * video, fold each GoPro recording's chapters into one ordered group, and treat
 * every standalone (non-GoPro) clip as its own group. The caller loads the group
 * directly when there's only one, or prompts the user to pick when there are
 * several — and discards the rest.
 */
export function groupVideoRecordings<T extends { name: string }>(files: T[]): VideoRecording<T>[] {
  const videos = orderVideoFiles(files.filter((f) => isVideoFile(f.name)));

  const groups = new Map<string, VideoRecording<T>>();
  let standaloneCount = 0;
  for (const file of videos) {
    const parts = parseGoProName(file.name);
    // Each standalone clip is its own recording (a unique key per file); GoPro
    // chapters collapse onto their shared recording key.
    const key = parts ? recordingKey(parts) : `single-${standaloneCount++}`;
    const existing = groups.get(key);
    if (existing) existing.files.push(file);
    else groups.set(key, { key, label: displayName(file.name), files: [file] });
  }

  // Map preserves insertion order, which follows `orderVideoFiles` (GoPro
  // recordings first by number, standalone clips after in selection order).
  return [...groups.values()];
}

/** Build a playlist with cumulative start offsets from ordered chunks. */
export function buildPlaylist(
  chunks: { name: string; durationSec: number }[],
): Playlist {
  let offset = 0;
  const built: PlaylistChunk[] = chunks.map((c) => {
    const duration = Number.isFinite(c.durationSec) && c.durationSec > 0 ? c.durationSec : 0;
    const chunk: PlaylistChunk = {
      name: c.name,
      durationSec: duration,
      startOffsetSec: offset,
    };
    offset += duration;
    return chunk;
  });
  return { chunks: built, totalDuration: offset };
}

/**
 * Map a virtual (whole-recording) time to a chunk index + local time within it.
 * Clamps to the playlist bounds; an empty playlist returns chunk 0 at time 0.
 */
export function virtualToLocal(
  playlist: Playlist,
  virtualSec: number,
): { index: number; localSec: number } {
  const { chunks, totalDuration } = playlist;
  if (chunks.length === 0) return { index: 0, localSec: 0 };

  const clamped = Math.max(0, Math.min(virtualSec, totalDuration));

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const end = chunk.startOffsetSec + chunk.durationSec;
    // Last chunk owns the exact end of the timeline.
    if (clamped < end || i === chunks.length - 1) {
      return { index: i, localSec: clamped - chunk.startOffsetSec };
    }
  }

  const last = chunks.length - 1;
  return { index: last, localSec: chunks[last].durationSec };
}

/** Map a chunk index + local time back to virtual (whole-recording) time. */
export function localToVirtual(
  playlist: Playlist,
  index: number,
  localSec: number,
): number {
  const { chunks } = playlist;
  if (chunks.length === 0) return 0;
  const i = Math.max(0, Math.min(index, chunks.length - 1));
  return chunks[i].startOffsetSec + Math.max(0, localSec);
}

/** Where one chunk's audio lands when concatenating a [startSec, endSec) export range. */
export interface AudioSegmentPlan {
  /** Index into the input chunk list. */
  index: number;
  /** First sample to copy from the chunk's own audio. */
  srcStartSample: number;
  /** Number of samples to copy. */
  lenSamples: number;
  /** Sample position in the output buffer to copy them to. */
  outStartSample: number;
}

/**
 * Plan how each chunk's audio maps into one concatenated output buffer covering
 * the virtual range [startSec, endSec). Pure sample-domain math so the
 * audio-stitching in the exporter is unit-testable; chunks that don't overlap
 * the range are omitted.
 */
export function planAudioSegments(
  chunks: { startOffsetSec: number; durationSec: number }[],
  startSec: number,
  endSec: number,
  sampleRate: number,
): AudioSegmentPlan[] {
  const plans: AudioSegmentPlan[] = [];
  if (endSec <= startSec || sampleRate <= 0) return plans;

  chunks.forEach((c, index) => {
    const chunkEnd = c.startOffsetSec + c.durationSec;
    const segStart = Math.max(startSec, c.startOffsetSec);
    const segEnd = Math.min(endSec, chunkEnd);
    if (segEnd <= segStart) return;

    plans.push({
      index,
      srcStartSample: Math.round((segStart - c.startOffsetSec) * sampleRate),
      lenSamples: Math.round((segEnd - segStart) * sampleRate),
      outStartSample: Math.round((segStart - startSec) * sampleRate),
    });
  });

  return plans;
}
