// Display-name profile access. The name is unique (DB constraint) but not a key
// and is user-editable: account creation auto-resolves a free name server-side,
// while an explicit edit surfaces a "taken" result so the user can pick another.

import { containsProfanity } from "@/lib/profanity";
import { isUniqueViolation, profiles, type ProfileRow } from "./cloudClient";

/** The signed-in user's profile, or null if it doesn't exist yet. */
export async function getMyProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await profiles()
    .select("user_id,display_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProfileRow | null) ?? null;
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
