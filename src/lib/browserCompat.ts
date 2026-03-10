export interface CapabilityCheck {
  feature: string;
  status: string;
  level: "green" | "yellow" | "red";
}

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
      status:
        typeof (globalThis as any).VideoEncoder !== "undefined"
          ? "MP4 (H.264)"
          : "WebM fallback",
      level:
        typeof (globalThis as any).VideoEncoder !== "undefined"
          ? "green"
          : "yellow",
    },
    {
      feature: "Audio in Export",
      status:
        typeof (globalThis as any).AudioEncoder !== "undefined"
          ? "Supported"
          : "Silent exports",
      level:
        typeof (globalThis as any).AudioEncoder !== "undefined"
          ? "green"
          : "yellow",
    },
    {
      feature: "BLE Datalogger",
      status: !!(navigator as any).bluetooth ? "Supported" : "Not Available",
      level: !!(navigator as any).bluetooth ? "green" : "red",
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
