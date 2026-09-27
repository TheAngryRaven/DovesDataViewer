/**
 * GoPro video import glue (plan 0029): File(s) in, a ready-to-save Dove CSV +
 * parsed session + the video sync offset out. Everything heavy is in the pure
 * modules next to this one; this file only touches `File`/`Blob`.
 */
import type { ParsedData } from "@/types/racing";
import { parseDoveFile } from "@/lib/doveParser";
import { orderVideoFiles } from "@/lib/videoPlaylist";
import { beginFileLoading, updateFileLoading, endFileLoading } from "@/lib/fileLoadingState";
import { blobByteSource, isIsoBmff, readGpmdTrack, readSamples } from "./mp4Boxes";
import { buildGoProSession, rowsFromPayloads, type GoProGpsRow, type GoProSession } from "./goproTelemetry";

/** Containers a GoPro writes; `.360` is the MAX/Fusion spherical variant. */
const GOPRO_VIDEO_EXTENSIONS = [".mp4", ".mov", ".360"];

/** Cheap name-based gate used before any bytes are read. */
export function isGoProVideoFile(name: string): boolean {
  const lower = name.toLowerCase();
  return GOPRO_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** True for an in-memory MP4/MOV — the sync content router refuses these. */
export function isGoProVideoBuffer(buffer: ArrayBuffer): boolean {
  return isIsoBmff(buffer);
}

/** The session file name a video import is saved under: `GH010042.MP4` → `GH010042.dove`. */
export function goProSessionFileName(videoName: string): string {
  const base = videoName.split(/[\\/]/).pop() ?? videoName;
  return `${base.replace(/\.[^.]+$/, "")}.dove`;
}

export interface GoProProgress {
  /** 1-based chapter being read. */
  chapter: number;
  chapters: number;
  /** Telemetry payloads read so far in this chapter. */
  done: number;
  total: number;
}

export type GoProProgressCallback = (progress: GoProProgress) => void;

export interface GoProExtraction extends GoProSession {
  /** Chapters in playback order (the order the rows were stitched in). */
  chapters: File[];
}

/**
 * Read the telemetry track of each chapter (in GoPro chapter order), stitch
 * the fixes onto one timeline and serialise the session. Throws with a clear
 * message when no chapter carries a `gpmd` track or no locked fix.
 */
export async function extractGoProTelemetry(
  files: File[],
  onProgress?: GoProProgressCallback,
): Promise<GoProExtraction> {
  const chapters = orderVideoFiles(files);
  if (chapters.length === 0) throw new Error("No video file selected");

  const rows: GoProGpsRow[] = [];
  let offsetSec = 0;
  let fallbackEpochMs: number | undefined;
  let sawTrack = false;
  for (let c = 0; c < chapters.length; c++) {
    const file = chapters[c];
    const src = blobByteSource(file);
    const track = await readGpmdTrack(src);
    if (!track) continue;
    sawTrack = true;
    fallbackEpochMs ??= track.creationEpochMs;
    const buffers = await readSamples(src, track.samples, (done, total) =>
      onProgress?.({ chapter: c + 1, chapters: chapters.length, done, total }),
    );
    const payloads = track.samples.map((s, i) => ({ data: buffers[i], timeSec: s.timeSec, durationSec: s.durationSec }));
    rows.push(...rowsFromPayloads(payloads, offsetSec));
    offsetSec += track.movieDurationSec;
  }
  if (!sawTrack) {
    throw new Error("No GoPro telemetry track found — only GPS-enabled GoPro videos (HERO5 and newer, GPS on) can be imported");
  }
  return { ...buildGoProSession(rows, fallbackEpochMs), chapters };
}

/**
 * Parser-contract entry used by `datalogParser`: the raw (un-normalised)
 * ParsedData for a GoPro video, exactly as `parseDoveFile` would produce from
 * the extracted CSV.
 */
export async function parseGoProVideoFile(file: File, onProgress?: GoProProgressCallback): Promise<ParsedData> {
  const extraction = await extractGoProTelemetry([file], onProgress);
  return parseDoveFile(extraction.csv);
}

export interface GoProImportResult extends GoProExtraction {
  /** Session file name to save/load under (`<first chapter>.dove`). */
  fileName: string;
  /** The Dove CSV as a Blob, ready for the file store. */
  blob: Blob;
}

/**
 * Full import: extract + name + blob, under the global file-load overlay (as
 * `parseDatalogFile` does). The caller parses the CSV via the normal router.
 */
export async function importGoProVideo(files: File[], onProgress?: GoProProgressCallback): Promise<GoProImportResult> {
  beginFileLoading("Reading GoPro telemetry…");
  try {
    const extraction = await extractGoProTelemetry(files, (p) => {
      updateFileLoading(`Reading GoPro telemetry… ${p.done}/${p.total}`);
      onProgress?.(p);
    });
    return {
      ...extraction,
      fileName: goProSessionFileName(extraction.chapters[0].name),
      blob: new Blob([extraction.csv], { type: "text/csv" }),
    };
  } finally {
    endFileLoading();
  }
}
