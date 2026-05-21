/**
 * Type augmentations for newer browser APIs not yet in our `lib` (DOM, ES2020).
 *
 * Keep these minimal — declare only the surface we actually use. The DOM lib
 * picks up newer APIs over time, so periodically check if entries here can
 * be removed.
 */

// ─── requestVideoFrameCallback (W3C WICG, Chrome 83+, Safari 15.4+) ─────────

interface VideoFrameCallbackMetadata {
  presentationTime: number;
  expectedDisplayTime: number;
  width: number;
  height: number;
  mediaTime: number;
  presentedFrames: number;
  processingDuration?: number;
}

type VideoFrameRequestCallback = (now: number, metadata: VideoFrameCallbackMetadata) => void;

interface HTMLVideoElement {
  requestVideoFrameCallback(callback: VideoFrameRequestCallback): number;
  cancelVideoFrameCallback(handle: number): void;
}

// ─── File System Access API (WICG, Chrome 86+, partial Safari) ──────────────
//
// The TS DOM lib has FileSystemFileHandle but doesn't yet ship
// queryPermission/requestPermission or window.showOpenFilePicker.

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemFileHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<"granted" | "denied" | "prompt">;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<"granted" | "denied" | "prompt">;
}

interface ShowOpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

interface Window {
  showOpenFilePicker(options?: ShowOpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
}
