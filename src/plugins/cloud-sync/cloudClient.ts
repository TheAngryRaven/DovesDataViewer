// Typed access to the cloud-sync backend (sync_records table + user-files
// bucket).
//
// The generated `integrations/supabase/types.ts` Database type does not yet
// include `sync_records` (Lovable regenerates it after the migration deploys),
// so `supabase.from('sync_records')` would be a compile error. We confine that
// gap to this one module: route the new table through an untyped view of the
// shared client and hand-write the row shape. When types are regenerated this
// can switch back to the typed `supabase` client with no call-site changes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const SYNC_BUCKET = "user-files";

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

/** A row in public.profiles — the user's unique, editable display name. */
export interface ProfileRow {
  user_id: string;
  display_name: string;
}

/** Query builder for the profiles table. */
export function profiles() {
  return untyped.from("profiles");
}

/** True when a Postgres error is a unique-constraint violation (e.g. taken name). */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return e.code === "23505" || /duplicate key|unique constraint/i.test(e.message ?? "");
}
