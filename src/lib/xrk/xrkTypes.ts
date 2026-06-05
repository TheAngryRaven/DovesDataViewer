// Shared message protocol + payload types for the XRK wasm worker.
//
// The worker instantiates the libxrk wasm module off the main thread, parses the
// uploaded bytes, resamples channels onto the GPS timebase, and ships the result
// back as transferable typed-array buffers (no giant JSON — sessions are large).
// The pure mapping in `xrkMapping.ts` turns this raw shape into `ParsedData`.

/** Progress phases surfaced to the UI while a session is parsed. */
export type XrkPhase =
  | "boot" // spawning worker / instantiating the wasm module (one-time)
  | "parse" // libxrk reading the binary
  | "extract" // resampling channels onto the GPS timebase
  | "done";

export interface XrkProgress {
  phase: XrkPhase;
  message: string;
  /** 0..1 when a meaningful fraction is known, else undefined (indeterminate). */
  ratio?: number;
}

/** One telemetry channel, already resampled onto the single shared timebase. */
export interface XrkChannel {
  /** libxrk channel name, e.g. "GPS Latitude", "Engine RPM", "WT". */
  name: string;
  /** libxrk unit string, e.g. "m/s", "rpm", "°C", "g" (may be empty). */
  unit: string;
  /** Float64 values aligned 1:1 with `timecodes`. */
  values: Float64Array;
}

/**
 * Raw, transport-friendly result of parsing one session. Every channel shares
 * the single `timecodes` axis (the GPS fix timebase). `metadata` is libxrk's
 * session-metadata dict; `laps` is libxrk's lap table (informational — the app
 * recomputes laps from the selected course).
 */
export interface XrkRawResult {
  /** Sample timestamps in milliseconds (not yet rebased to zero). */
  timecodes: Float64Array;
  channels: XrkChannel[];
  metadata: Record<string, string | number>;
  laps: { num: number[]; start: number[]; end: number[] };
}

/** main -> worker */
export interface XrkParseRequest {
  type: "parse";
  fileName: string;
  buffer: ArrayBuffer;
}

/** worker -> main */
export type XrkWorkerMessage =
  | { type: "progress"; progress: XrkProgress }
  | { type: "result"; result: XrkRawResult }
  | { type: "error"; message: string };
