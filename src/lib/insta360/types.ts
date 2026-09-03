/**
 * Insta360 camera bridge — the contract with the LapWing shell's `insta360_*`
 * commands (LapWing `docs/insta360.md`, plan 0025 here). Native-only: the
 * web build never imports the IPC module, only these types.
 */

export type Insta360ConnectType = "wifi" | "usb" | "ble";

export interface Insta360SdkInfo {
  /** False on the desktop stub and on Android builds made without the SDK. */
  available: boolean;
  cameraSdkVersion?: string;
  mediaSdkVersion?: string;
  note?: string;
}

export interface Insta360CameraInfo {
  cameraType: string;
  serial?: string;
  firmware?: string;
  connectType: Insta360ConnectType;
  httpPrefix?: string;
}

export interface Insta360CameraStatus {
  connected: boolean;
  camera?: Insta360CameraInfo;
  batteryPercent?: number;
  charging?: boolean;
  sdCard?: string;
}

/** One recording on the camera, as the shell lists it (newest first). */
export interface Insta360CameraFile {
  id: string;
  name: string;
  urls: string[];
  lrvUrls: string[];
  is360: boolean;
  durationMs: number;
  width: number;
  height: number;
  size: number;
  segmentCount: number;
  /** Camera-local wall clock, `YYYY-MM-DDTHH:MM:SS`, when known. */
  recordedAt?: string;
  createdAtMs: number;
  cameraType?: string;
}

/** Wi-Fi join request forwarded to the shell's network binder. */
export interface Insta360WifiJoin {
  ssid?: string;
  /** `"*"` = let the OS picker show every network. */
  ssidPrefix?: string;
  passphrase?: string;
}

export interface Insta360PlayerRequest {
  urls: string[];
  is360: boolean;
  preferProxy: boolean;
  width: number;
  height: number;
  fps: number;
  quality: number;
  muted: boolean;
}

export interface Insta360PlayerInfo {
  /** Loopback MJPEG stream for an `<img>`. */
  streamUrl: string;
  width: number;
  height: number;
  durationMs: number;
  is360: boolean;
}

export type Insta360PlayerCommand =
  | { action: "play" }
  | { action: "pause" }
  | { action: "seek"; positionMs: number; precise: boolean }
  | { action: "setMuted"; muted: boolean };

/** Degrees. Yaw wraps in [-180, 180), pitch ±90, fov 30–150. */
export interface ViewPose {
  yaw: number;
  pitch: number;
  fov: number;
}

export const DEFAULT_VIEW_POSE: ViewPose = { yaw: 0, pitch: 0, fov: 90 };

export type Insta360PlayerEventKind = "opened" | "status" | "seeked" | "ended" | "error" | "closed";

export interface Insta360PlayerEvent {
  kind: Insta360PlayerEventKind;
  positionMs: number;
  durationMs: number;
  playing: boolean;
  message?: string;
}
