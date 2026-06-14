// Pure capability detection. Returns stable string ids (not display text) so the
// presentation layer (BrowserCompatDialog) can translate them — keeping this
// module i18n-free. The ids match the `landing.browserCompat.features` /
// `.statuses` locale keys.

export type CapabilityLevel = "green" | "yellow" | "red";

export type FeatureId =
  | "gpsFileParsing"
  | "videoSync"
  | "videoExport"
  | "audioInExport"
  | "bleDatalogger"
  | "filePicker"
  | "pwaOffline";

export type StatusId =
  | "supported"
  | "notAvailable"
  | "frameAccurate"
  | "approximateSync"
  | "mp4H264"
  | "webmFallback"
  | "silentExports"
  | "native"
  | "fileInputFallback";

export interface CapabilityCheck {
  feature: FeatureId;
  status: StatusId;
  level: CapabilityLevel;
}

// `"X" in Y` is a runtime feature check that TypeScript narrows without
// needing a cast. Cleaner than `(globalThis as any).X !== undefined`.
const hasVideoEncoder = "VideoEncoder" in globalThis;
const hasAudioEncoder = "AudioEncoder" in globalThis;
const hasBluetooth = "bluetooth" in navigator;

export function detectCapabilities(): CapabilityCheck[] {
  const hasIndexedDb = "indexedDB" in window;
  const hasFrameCallback = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
  const hasFilePicker = "showOpenFilePicker" in window;
  const hasServiceWorker = "serviceWorker" in navigator;

  return [
    {
      feature: "gpsFileParsing",
      status: hasIndexedDb ? "supported" : "notAvailable",
      level: hasIndexedDb ? "green" : "red",
    },
    {
      feature: "videoSync",
      status: hasFrameCallback ? "frameAccurate" : "approximateSync",
      level: hasFrameCallback ? "green" : "yellow",
    },
    {
      feature: "videoExport",
      status: hasVideoEncoder ? "mp4H264" : "webmFallback",
      level: hasVideoEncoder ? "green" : "yellow",
    },
    {
      feature: "audioInExport",
      status: hasAudioEncoder ? "supported" : "silentExports",
      level: hasAudioEncoder ? "green" : "yellow",
    },
    {
      feature: "bleDatalogger",
      status: hasBluetooth ? "supported" : "notAvailable",
      level: hasBluetooth ? "green" : "red",
    },
    {
      feature: "filePicker",
      status: hasFilePicker ? "native" : "fileInputFallback",
      level: hasFilePicker ? "green" : "yellow",
    },
    {
      feature: "pwaOffline",
      status: hasServiceWorker ? "supported" : "notAvailable",
      level: hasServiceWorker ? "green" : "red",
    },
  ];
}
