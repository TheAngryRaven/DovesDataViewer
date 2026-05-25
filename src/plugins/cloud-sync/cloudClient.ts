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

/** Storage API for the private per-user file bucket. */
export function userFiles() {
  return untyped.storage.from(SYNC_BUCKET);
}

/** One tier's usage as returned by the server's sync_storage_usage() RPC. */
export interface StorageUsageRow {
  tier: string;
  used_bytes: number;
  limit_bytes: number;
}

/** Per-tier storage usage for the current user (authoritative, server-computed). */
export async function fetchStorageUsage(): Promise<StorageUsageRow[]> {
  const { data, error } = await untyped.rpc("sync_storage_usage");
  if (error) throw new Error(`Failed to read storage usage: ${error.message}`);
  return (data ?? []) as StorageUsageRow[];
}

/** True when an error from a sync_records write is the server quota rejection. */
export function isQuotaError(err: unknown): boolean {
  return err instanceof Error && /quota_exceeded/i.test(err.message);
}
