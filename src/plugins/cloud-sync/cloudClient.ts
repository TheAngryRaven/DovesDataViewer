// Typed access to the cloud-sync backend (sync_records table + user-files
// bucket).
//
// The generated `integrations/supabase/types.ts` Database type does not yet
// include `sync_records` (regenerated from Supabase after the migration deploys),
// so `supabase.from('sync_records')` would be a compile error. We confine that
// gap to this one module: route the new table through an untyped view of the
// shared client and hand-write the row shape. When types are regenerated this
// can switch back to the typed `supabase` client with no call-site changes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const SYNC_BUCKET = "user-files";
export const AVATAR_BUCKET = "user-avatars";

/** A row in public.sync_records — one client record stored as a jsonb document. */
export interface SyncRecordRow {
  user_id: string;
  store: string;
  record_key: string;
  data: unknown;
  updated_at?: string;
}

// Untyped view of the shared client — same auth/session, no Database generic.
const untyped = supabase as unknown as SupabaseClient;

/** Query builder for the sync_records table. */
export function syncRecords() {
  return untyped.from("sync_records");
}

/** A row in public.lap_snapshots — one frozen lap capture, one per engine+course. */
export interface LapSnapshotRow {
  id?: string;
  user_id: string;
  course_key: string;
  engine_key: string;
  data: unknown;
  updated_at?: string;
}

/** Query builder for the lap_snapshots table (snapshots count toward the byte pool). */
export function lapSnapshotsTable() {
  return untyped.from("lap_snapshots");
}

/** Storage API for the private per-user file bucket. */
export function userFiles() {
  return untyped.storage.from(SYNC_BUCKET);
}

/** Storage API for the public per-user avatar bucket. */
export function userAvatars() {
  return untyped.storage.from(AVATAR_BUCKET);
}

/** The single-row pooled-usage shape returned by the server's sync_storage_usage() RPC. */
export interface StorageUsageRow {
  documents_bytes: number;
  logs_bytes: number;
  snapshots_bytes: number;
  total_limit_bytes: number;
}

/** Pooled storage usage for the current user (authoritative, server-computed). */
export async function fetchStorageUsage(): Promise<StorageUsageRow | null> {
  const { data, error } = await untyped.rpc("sync_storage_usage");
  if (error) throw new Error(`Failed to read storage usage: ${error.message}`);
  return ((data ?? []) as StorageUsageRow[])[0] ?? null;
}

/**
 * True when an error from a sync_records or lap_snapshots write is the server's
 * pooled-quota rejection. Both tables now raise the same `quota_exceeded` code.
 */
export function isQuotaError(err: unknown): boolean {
  return err instanceof Error && /quota_exceeded/i.test(err.message);
}

/** A row in public.profiles — the user's unique, editable display name + avatar. */
export interface ProfileRow {
  user_id: string;
  display_name: string;
  /** Object path in the user-avatars bucket, or null when no avatar is set. */
  avatar_path?: string | null;
  /** Last avatar change — used as a ?v= cache-buster on the public URL. */
  avatar_updated_at?: string | null;
}

/** Query builder for the profiles table (owner reads/writes). */
export function profiles() {
  return untyped.from("profiles");
}

/** A row in public.public_profiles — the anon-readable, column-limited view. */
export interface PublicProfileRow {
  user_id: string;
  display_name: string;
  avatar_path: string | null;
  avatar_updated_at: string | null;
}

/** Query builder for the anon-readable public_profiles view. */
export function publicProfilesView() {
  return untyped.from("public_profiles");
}

/** A row in public.public_vehicles — a user's opt-in, public-safe vehicle. */
export interface PublicVehicleRow {
  user_id: string;
  vehicle_id: string;
  name: string;
  type_name: string | null;
  engine: string;
  number: number;
  updated_at?: string;
}

/** Query builder for the public_vehicles projection table. */
export function publicVehicles() {
  return untyped.from("public_vehicles");
}

/** True when a Postgres error is a unique-constraint violation (e.g. taken name). */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return e.code === "23505" || /duplicate key|unique constraint/i.test(e.message ?? "");
}
