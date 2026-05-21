export interface CapabilityCheck {
  feature: string;
  status: string;
  level: "green" | "yellow" | "red";
}

// `"X" in Y` is a runtime feature check that TypeScript narrows without
// needing a cast. Cleaner than `(globalThis as any).X !== undefined`.
const hasVideoEncoder = "VideoEncoder" in globalThis;
const hasAudioEncoder = "AudioEncoder" in globalThis;
const hasBluetooth = "bluetooth" in navigator;

export function detectCapabilities(): CapabilityCheck[] {
  return [
    {
      feature: "GPS File Parsing",
      status: "indexedDB" in window ? "Supported" : "Not Available",
      level: "indexedDB" in window ? "green" : "red",
    },
    {
      feature: "Video Sync",
      status:
        "requestVideoFrameCallback" in HTMLVideoElement.prototype
          ? "Frame-accurate"
          : "Approximate sync",
      level:
        "requestVideoFrameCallback" in HTMLVideoElement.prototype
          ? "green"
          : "yellow",
    },
    {
      feature: "Video Export (MP4)",
      status: hasVideoEncoder ? "MP4 (H.264)" : "WebM fallback",
      level: hasVideoEncoder ? "green" : "yellow",
    },
    {
      feature: "Audio in Export",
      status: hasAudioEncoder ? "Supported" : "Silent exports",
      level: hasAudioEncoder ? "green" : "yellow",
    },
    {
      feature: "BLE Datalogger",
      status: hasBluetooth ? "Supported" : "Not Available",
      level: hasBluetooth ? "green" : "red",
    },
    {
      feature: "File Picker",
      status:
        "showOpenFilePicker" in window
          ? "Native"
          : "File input fallback",
      level: "showOpenFilePicker" in window ? "green" : "yellow",
    },
    {
      feature: "PWA / Offline",
      status: "serviceWorker" in navigator ? "Supported" : "Not Available",
      level: "serviceWorker" in navigator ? "green" : "red",
    },
  ];
}
