// One-shot handoff from a GoPro import to the video player (plan 0029).
//
// The import already holds the video file(s) and knows the exact sync offset
// (telemetry and footage share the MP4 clock), so it stages them here under the
// session file name before the session loads. `useVideoSync` consumes the entry
// the moment that session becomes current and loads the playlist pre-synced and
// locked — no manual sync step. Same module-singleton pattern as
// `leaderboardHandoff`: a one-shot handoff, not reactive state.

export interface StagedVideoFile {
  name: string;
  file: File;
  handle?: FileSystemFileHandle;
}

export interface StagedGoProVideo {
  sessionFileName: string;
  /** Chapters in playback order. */
  files: StagedVideoFile[];
  /** Session ms that lines up with video virtual time 0. */
  syncOffsetMs: number;
}

let pending: StagedGoProVideo | null = null;

export function stageGoProVideo(staged: StagedGoProVideo): void {
  pending = staged;
}

/** Consume the staged video for `sessionFileName` (clears it); null otherwise. */
export function takeStagedGoProVideo(sessionFileName: string): StagedGoProVideo | null {
  if (!pending || pending.sessionFileName !== sessionFileName) return null;
  const p = pending;
  pending = null;
  return p;
}
