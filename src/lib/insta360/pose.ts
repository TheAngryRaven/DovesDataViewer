/**
 * 360° view-pose math — pure. The preview is a flat reframe of the sphere;
 * the user points it by dragging the picture (like the Insta360 app), and
 * the shell applies the resulting pose to the native player.
 */

import { DEFAULT_VIEW_POSE, type ViewPose } from "./types";

export const FOV_MIN = 30;
export const FOV_MAX = 150;
export const PITCH_MAX = 90;

/** Degrees into [-180, 180). */
export function wrapYaw(deg: number): number {
  let y = ((deg % 360) + 360) % 360;
  if (y >= 180) y -= 360;
  return y;
}

/** Yaw wrapped, pitch and fov clamped; non-finite parts fall back to default. */
export function normalizePose(pose: ViewPose): ViewPose {
  return {
    yaw: Number.isFinite(pose.yaw) ? wrapYaw(pose.yaw) : DEFAULT_VIEW_POSE.yaw,
    pitch: Number.isFinite(pose.pitch)
      ? Math.max(-PITCH_MAX, Math.min(PITCH_MAX, pose.pitch))
      : DEFAULT_VIEW_POSE.pitch,
    fov: Number.isFinite(pose.fov) ? Math.max(FOV_MIN, Math.min(FOV_MAX, pose.fov)) : DEFAULT_VIEW_POSE.fov,
  };
}

/**
 * Turn a drag across the picture into a new pose. A drag of the picture's
 * full width sweeps the current horizontal field of view, so the scene
 * follows the finger 1:1 at any zoom — the convention every 360° player
 * uses. Dragging right shows what's to the left (yaw decreases); dragging
 * down shows what's above (pitch increases).
 */
export function dragToPose(
  pose: ViewPose,
  dxPx: number,
  dyPx: number,
  pictureWidthPx: number,
  pictureHeightPx: number,
): ViewPose {
  if (pictureWidthPx <= 0 || pictureHeightPx <= 0) return normalizePose(pose);
  const degPerPxX = pose.fov / pictureWidthPx;
  // Vertical fov follows the aspect ratio of the flat picture.
  const vFov = pose.fov * (pictureHeightPx / pictureWidthPx);
  const degPerPxY = vFov / pictureHeightPx;
  return normalizePose({
    yaw: pose.yaw - dxPx * degPerPxX,
    pitch: pose.pitch + dyPx * degPerPxY,
    fov: pose.fov,
  });
}

/** Pinch: scale > 1 zooms in (narrower fov). */
export function pinchToPose(pose: ViewPose, scale: number): ViewPose {
  if (!Number.isFinite(scale) || scale <= 0) return normalizePose(pose);
  return normalizePose({ ...pose, fov: pose.fov / scale });
}

/** True when two poses are visually the same (sub-tenth-degree). */
export function samePose(a: ViewPose, b: ViewPose): boolean {
  return (
    Math.abs(wrapYaw(a.yaw - b.yaw)) < 0.1 && Math.abs(a.pitch - b.pitch) < 0.1 && Math.abs(a.fov - b.fov) < 0.1
  );
}
