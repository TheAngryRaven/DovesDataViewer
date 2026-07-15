// Anonymous, public reads for shared-session links (plan 0009): the /s/:token
// viewer and the driver profile's "Shared sessions" list. Everything here goes
// through the anon-readable shared_sessions table and the public blob bucket —
// no auth required, mirroring publicProfile.ts. The filename never appears in
// any of these surfaces (the table doesn't store it).

import { sharedFiles, sharedSessions, type SharedSessionRow } from "./cloudClient";
import type { Course } from "@/types/racing";

export interface PublicSharedSession {
  token: string;
  userId: string;
  /** File extension for parser routing (e.g. "dovex") — never the filename. */
  fileExt: string;
  /** Frozen course geometry captured at share time. */
  course: Course;
  trackName: string;
  courseName: string;
  sessionDate: Date | null;
  fastestLapMs: number | null;
  /** The sharing driver's live display name (profile embed), or null. */
  driverName: string | null;
}

/** The light row shape for listing a driver's shared sessions (no course payload). */
export interface PublicSharedSessionSummary {
  token: string;
  trackName: string;
  courseName: string;
  sessionDate: Date | null;
  fastestLapMs: number | null;
  createdAt: Date | null;
}

function embeddedDisplayName(row: SharedSessionRow): string | null {
  const p = row.profiles;
  if (!p) return null;
  const one = Array.isArray(p) ? p[0] : p;
  return one?.display_name ?? null;
}

/** Resolve a share token to its full public row, or null when it doesn't exist. */
export async function fetchSharedSession(token: string): Promise<PublicSharedSession | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const { data, error } = await sharedSessions()
    .select("*, profiles!shared_sessions_profile_fkey(display_name)")
    .eq("token", trimmed)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as SharedSessionRow;
  return {
    token: row.token,
    userId: row.user_id,
    fileExt: row.file_ext,
    course: row.course as Course,
    trackName: row.track_name,
    courseName: row.course_name,
    sessionDate: row.session_date ? new Date(row.session_date) : null,
    fastestLapMs: row.fastest_lap_ms,
    driverName: embeddedDisplayName(row),
  };
}

/** Public URL of a share's raw log blob. */
export function sharedBlobUrl(userId: string, token: string): string | null {
  const { data } = sharedFiles().getPublicUrl(`${userId}/${token}`);
  return data?.publicUrl ?? null;
}

/** A driver's shared sessions, newest first (light columns for the profile page). */
export async function fetchSharedSessionsByUser(
  userId: string,
): Promise<PublicSharedSessionSummary[]> {
  const { data, error } = await sharedSessions()
    .select("token,track_name,course_name,session_date,fastest_lap_ms,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SharedSessionRow[]).map((r) => ({
    token: r.token,
    trackName: r.track_name,
    courseName: r.course_name,
    sessionDate: r.session_date ? new Date(r.session_date) : null,
    fastestLapMs: r.fastest_lap_ms,
    createdAt: r.created_at ? new Date(r.created_at) : null,
  }));
}
