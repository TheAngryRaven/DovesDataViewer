// Anonymous, public reads for the driver profile page (/driver/:username) and
// the Leaderboards avatar thumbnails. Kept separate from profile.ts (owner-only
// reads/writes): everything here goes through the column-limited public_profiles
// view and the public_vehicles projection, both anon-readable by RLS. Names are
// matched case-insensitively so a profile resolves regardless of URL casing.

import {
  avatarPublicUrl,
} from "./profile";
import {
  publicProfilesView,
  publicVehicles,
  type PublicProfileRow,
  type PublicVehicleRow,
} from "./cloudClient";

export interface PublicProfile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PublicVehicle {
  vehicleId: string;
  name: string;
  typeName: string | null;
  engine: string;
  number: number;
}

/** Escape PostgREST ilike wildcards so a name is matched literally (not as a pattern). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function toPublicProfile(row: PublicProfileRow): PublicProfile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    avatarUrl: avatarPublicUrl(row),
  };
}

/** Resolve a display name (case-insensitive, exact) to its public profile, or null. */
export async function fetchPublicProfileByName(name: string): Promise<PublicProfile | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { data, error } = await publicProfilesView()
    .select("user_id,display_name,avatar_path,avatar_updated_at")
    .ilike("display_name", escapeLike(trimmed))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toPublicProfile(data as PublicProfileRow) : null;
}

/** The user's opt-in, public-safe vehicles (no weight, no setup), number-ordered. */
export async function fetchPublicVehicles(userId: string): Promise<PublicVehicle[]> {
  const { data, error } = await publicVehicles()
    .select("vehicle_id,name,type_name,engine,number")
    .eq("user_id", userId)
    .order("number", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PublicVehicleRow[]).map((r) => ({
    vehicleId: r.vehicle_id,
    name: r.name,
    typeName: r.type_name,
    engine: r.engine,
    number: r.number,
  }));
}

/** All public profiles keyed by user id — one query, used for leaderboard avatar thumbnails. */
export async function fetchAllPublicProfiles(): Promise<Map<string, PublicProfile>> {
  const { data, error } = await publicProfilesView()
    .select("user_id,display_name,avatar_path,avatar_updated_at");
  if (error) throw new Error(error.message);
  const map = new Map<string, PublicProfile>();
  for (const row of (data ?? []) as PublicProfileRow[]) {
    map.set(row.user_id, toPublicProfile(row));
  }
  return map;
}
