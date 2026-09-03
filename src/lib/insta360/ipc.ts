/**
 * Insta360 IPC wrappers — native (Tauri) only, reached through the shared
 * lazy loader in `loggers/native/ipc.ts` so `@tauri-apps/api` stays out of
 * the web bundle. Errors are plain strings; an `unsupported:` prefix means
 * this shell can't talk to a camera (desktop, or an Android build without
 * the SDK) — `isInsta360Unavailable` folds a shell that predates these
 * commands into the same answer.
 */

import { api } from "@/lib/loggers/native/ipc";
import { isNativeApp } from "@/lib/platform";
import type {
  Insta360CameraFile,
  Insta360CameraInfo,
  Insta360CameraStatus,
  Insta360ConnectType,
  Insta360PlayerCommand,
  Insta360PlayerEvent,
  Insta360PlayerInfo,
  Insta360PlayerRequest,
  Insta360SdkInfo,
  Insta360WifiJoin,
  ViewPose,
} from "./types";

/** The stub sentinel, or a shell that doesn't know the command at all. */
export function isInsta360Unavailable(err: unknown): boolean {
  const msg = String(err);
  return msg.startsWith("unsupported:") || /unknown|not found|not allowed/i.test(msg);
}

/**
 * Whether this shell can talk to an Insta360 camera. Resolves `false` off
 * native, on the stubs, and on a shell that predates the feature — never
 * throws, so a UI can gate on it unconditionally.
 */
export async function insta360SdkInfo(): Promise<Insta360SdkInfo> {
  if (!isNativeApp()) return { available: false, note: "not the native app" };
  try {
    const { invoke } = await api();
    return await invoke<Insta360SdkInfo>("insta360_sdk_info");
  } catch (err) {
    return { available: false, note: String(err) };
  }
}

export async function insta360Connect(
  connectType: Insta360ConnectType,
  wifi?: Insta360WifiJoin,
): Promise<Insta360CameraInfo> {
  const { invoke } = await api();
  return invoke<Insta360CameraInfo>("insta360_connect", { connectType, wifi: wifi ?? null });
}

/** Best effort: never throws (already disconnected / old shell). */
export async function insta360Disconnect(): Promise<void> {
  try {
    const { invoke } = await api();
    await invoke("insta360_disconnect");
  } catch {
    // Nothing to tear down.
  }
}

export async function insta360Status(): Promise<Insta360CameraStatus> {
  const { invoke } = await api();
  return invoke<Insta360CameraStatus>("insta360_status");
}

export async function insta360ListFiles(): Promise<Insta360CameraFile[]> {
  const { invoke } = await api();
  return invoke<Insta360CameraFile[]>("insta360_list_files");
}

/**
 * Open the streaming player. Events keep arriving on `onEvent` until the
 * player is closed; the returned info carries the MJPEG URL to show.
 */
export async function insta360OpenPlayer(
  request: Insta360PlayerRequest,
  onEvent: (e: Insta360PlayerEvent) => void,
): Promise<Insta360PlayerInfo> {
  const { invoke, Channel } = await api();
  const channel = new Channel<Insta360PlayerEvent>();
  channel.onmessage = onEvent;
  return invoke<Insta360PlayerInfo>("insta360_player_open", { request, onEvent: channel });
}

export async function insta360PlayerControl(command: Insta360PlayerCommand): Promise<void> {
  const { invoke } = await api();
  await invoke("insta360_player_control", { command });
}

/** Point the 360° view; resolves to the pose the player actually reached. */
export async function insta360SetView(pose: ViewPose): Promise<ViewPose> {
  const { invoke } = await api();
  return invoke<ViewPose>("insta360_player_set_view", { pose });
}

export async function insta360GetView(): Promise<ViewPose> {
  const { invoke } = await api();
  return invoke<ViewPose>("insta360_player_get_view");
}

/** Best effort: never throws. */
export async function insta360ClosePlayer(): Promise<void> {
  try {
    const { invoke } = await api();
    await invoke("insta360_player_close");
  } catch {
    // Already closed.
  }
}
