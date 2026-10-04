import type { Insta360CameraFile, Insta360CameraInfo, Insta360CameraStatus } from "./types";

/** The Insta360 import dialog's UI phase. */
export type Insta360DialogPhase = "idle" | "connecting" | "listing" | "ready" | "error";

export interface ResumeDeps {
  status: () => Promise<Insta360CameraStatus>;
  listFiles: () => Promise<Insta360CameraFile[]>;
}

export interface ResumeSink {
  /**
   * Checked once, after the status answer and before any state is touched:
   * false when the dialog closed meanwhile or the user already started a
   * connect of their own, so a late status answer cannot hijack that flow.
   */
  canResume: () => boolean;
  setCamera: (camera: Insta360CameraInfo) => void;
  setFiles: (files: Insta360CameraFile[]) => void;
  setPhase: (phase: Insta360DialogPhase) => void;
}

/**
 * Reopening the dialog while a camera is still connected (a stream is
 * playing) resumes at the recording list (plan 0025).
 *
 * `canResume` is deliberately NOT re-checked once this has moved the phase to
 * "listing": that move is this function's own doing, and treating it as a
 * reason to abandon the listing is what left the dialog spinning forever. A
 * failed listing drops back to idle rather than stranding the spinner.
 */
export async function resumeInsta360Session(deps: ResumeDeps, sink: ResumeSink): Promise<void> {
  let status: Insta360CameraStatus;
  try {
    status = await deps.status();
  } catch {
    return; // not connected — stay idle
  }
  if (!sink.canResume() || !status.connected || !status.camera) return;
  sink.setCamera(status.camera);
  sink.setPhase("listing");
  try {
    sink.setFiles(await deps.listFiles());
    sink.setPhase("ready");
  } catch {
    sink.setPhase("idle");
  }
}
