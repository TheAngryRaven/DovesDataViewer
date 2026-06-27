// Display-name profile access. The name is unique (DB constraint) but not a key
// and is user-editable: account creation auto-resolves a free name server-side,
// while an explicit edit surfaces a "taken" result so the user can pick another.

import { containsProfanity } from "@/lib/profanity";
import { isUniqueViolation, profiles, userAvatars, type ProfileRow } from "./cloudClient";

/** The signed-in user's profile, or null if it doesn't exist yet. */
export async function getMyProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await profiles()
    .select("user_id,display_name,avatar_path,avatar_updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProfileRow | null) ?? null;
}

/**
 * Public URL for a profile's avatar, with a ?v= cache-buster derived from
 * avatar_updated_at (the object path is fixed, so a replaced avatar would
 * otherwise serve the stale cached image). Null when no avatar is set.
 */
export function avatarPublicUrl(
  p: Pick<ProfileRow, "avatar_path" | "avatar_updated_at"> | null | undefined,
): string | null {
  if (!p?.avatar_path) return null;
  const { data } = userAvatars().getPublicUrl(p.avatar_path);
  if (!data?.publicUrl) return null;
  const v = p.avatar_updated_at ? Date.parse(p.avatar_updated_at) : 0;
  return v ? `${data.publicUrl}?v=${v}` : data.publicUrl;
}

/** Extension for the stored avatar object, derived from the (already-cropped) blob type. */
function avatarExt(type: string): string {
  return type.includes("webp") ? "webp" : "jpg";
}

/**
 * Upload a cropped avatar blob to the public bucket at a fixed per-user path and
 * record the new path + timestamp on the profile. Returns the stored fields so
 * the caller can repaint immediately via the cache-buster.
 */
export async function uploadAvatar(
  userId: string,
  blob: Blob,
): Promise<{ avatar_path: string; avatar_updated_at: string }> {
  const path = `${userId}/avatar.${avatarExt(blob.type)}`;
  const up = await userAvatars().upload(path, blob, {
    upsert: true,
    contentType: blob.type || "image/jpeg",
  });
  if (up.error) throw new Error(up.error.message);

  const now = new Date().toISOString();
  const { error } = await profiles()
    .update({ avatar_path: path, avatar_updated_at: now })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { avatar_path: path, avatar_updated_at: now };
}

export type UpdateNameResult =
  | { ok: true }
  | { ok: false; reason: "taken" | "empty" | "profanity" | "error"; message?: string };

/** Change the display name, reporting a taken/profane name distinctly so the UI can prompt. */
export async function updateDisplayName(userId: string, name: string): Promise<UpdateNameResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (containsProfanity(trimmed)) return { ok: false, reason: "profanity" };

  const { error } = await profiles()
    .update({ display_name: trimmed, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "taken" };
    return { ok: false, reason: "error", message: error.message };
  }
  return { ok: true };
}
