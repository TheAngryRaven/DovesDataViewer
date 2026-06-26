// Untyped access to the leaderboard tables (plan 0005). Same pattern as
// cloudClient.ts: the generated Database type doesn't yet include
// leaderboard_entries / engine_classes, so route them through an untyped view of
// the shared client and hand-map rows. Public reads work for anonymous visitors
// (RLS allows anon select on approved rows + engine classes).

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { LapSnapshot } from "@/lib/lapSnapshot";
import type {
  EngineClass,
  LeaderboardEntry,
  LeaderboardEntryData,
} from "@/lib/leaderboardTypes";
import { buildEntryData, contentHashForSnapshot } from "./leaderboardSubmission";

/** A snapshot courseKey for a reverse-direction lap ends with the "reverse" marker. */
function isReverseCourseKey(courseKey: string): boolean {
  return courseKey.endsWith("reverse");
}

const untyped = supabase as unknown as SupabaseClient;

export function leaderboardEntriesTable() {
  return untyped.from("leaderboard_entries");
}
export function engineClassesTable() {
  return untyped.from("engine_classes");
}

/** Columns selected for the lightweight browse tree (everything except `data`). */
export const LIGHT_COLUMNS =
  "id,user_id,display_name,track_name,course_name,course_key,direction,engine,engine_key,engine_class_id,listed_weight,listed_weight_unit,lap_time_ms,content_hash,setup_public,engine_telemetry_public,status,created_at";

interface EntryRow {
  id: string;
  user_id: string;
  display_name: string;
  track_name: string;
  course_name: string;
  course_key: string;
  direction: string | null;
  engine: string;
  engine_key: string;
  engine_class_id: string | null;
  listed_weight: number | null;
  listed_weight_unit: "lb" | "kg" | null;
  lap_time_ms: number;
  content_hash: string;
  setup_public: boolean;
  engine_telemetry_public: boolean;
  status: "approved" | "denied";
  created_at: string;
  class_source?: "auto" | "admin";
  admin_notes?: string | null;
  data?: LeaderboardEntryData;
}

export function mapEntryRow(r: EntryRow): LeaderboardEntry {
  return {
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name,
    trackName: r.track_name,
    courseName: r.course_name,
    courseKey: r.course_key,
    direction: r.direction,
    engine: r.engine,
    engineKey: r.engine_key,
    engineClassId: r.engine_class_id,
    listedWeight: r.listed_weight,
    listedWeightUnit: r.listed_weight_unit,
    lapTimeMs: r.lap_time_ms,
    contentHash: r.content_hash,
    setupPublic: r.setup_public,
    engineTelemetryPublic: r.engine_telemetry_public,
    status: r.status,
    createdAt: r.created_at,
    classSource: r.class_source,
    adminNotes: r.admin_notes,
    data: r.data,
  };
}

interface EngineClassRow {
  id: string;
  name: string;
  keywords: string[] | null;
  sort_order: number;
}

export function mapEngineClassRow(r: EngineClassRow): EngineClass {
  return { id: r.id, name: r.name, keywords: r.keywords ?? [], sortOrder: r.sort_order };
}

/** All engine classes (public read), ordered as the admin arranged them. */
export async function fetchEngineClasses(): Promise<EngineClass[]> {
  const { data, error } = await engineClassesTable().select("*").order("sort_order");
  if (error) throw new Error(error.message);
  return ((data ?? []) as EngineClassRow[]).map(mapEngineClassRow);
}

/** Lightweight rows (no `data`) for every approved entry — the browse tree. */
export async function fetchApprovedLight(): Promise<LeaderboardEntry[]> {
  const { data, error } = await leaderboardEntriesTable()
    .select(LIGHT_COLUMNS)
    .eq("status", "approved");
  if (error) throw new Error(error.message);
  return ((data ?? []) as EntryRow[]).map(mapEntryRow);
}

/**
 * Full rows (with `data`) for one engine[/weight] group, fastest first. `limit`
 * null loads all. Grouping is resolved client-side, so callers pass the already
 * computed entry ids for the chosen group.
 */
export async function fetchGroupEntries(ids: string[], limit: number | null): Promise<LeaderboardEntry[]> {
  if (ids.length === 0) return [];
  let q = leaderboardEntriesTable()
    .select(`${LIGHT_COLUMNS},data`)
    .in("id", ids)
    .eq("status", "approved")
    .order("lap_time_ms", { ascending: true });
  if (limit !== null) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as EntryRow[]).map(mapEntryRow);
}

/** The signed-in user's own entries (light) — for the submitted/withdraw list. */
export async function fetchMyEntries(userId: string): Promise<LeaderboardEntry[]> {
  const { data, error } = await leaderboardEntriesTable()
    .select(LIGHT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as EntryRow[]).map(mapEntryRow);
}

/** A row to insert into leaderboard_entries (snake_case, server fills defaults). */
export interface NewEntryRow {
  user_id: string;
  display_name: string;
  track_name: string;
  course_name: string;
  course_key: string;
  direction: string | null;
  engine: string;
  engine_key: string;
  listed_weight: number;
  listed_weight_unit: "lb" | "kg";
  lap_time_ms: number;
  content_hash: string;
  setup_public: boolean;
  engine_telemetry_public: boolean;
  data: LeaderboardEntryData;
}

export interface SubmitOptions {
  userId: string;
  displayName: string;
  setupPublic: boolean;
  engineTelemetryPublic: boolean;
  listedWeight: number;
  listedWeightUnit: "lb" | "kg";
}

/** Assemble the insert row for a snapshot, applying privacy + content hashing. */
export function buildNewEntryRow(snap: LapSnapshot, opts: SubmitOptions): NewEntryRow {
  return {
    user_id: opts.userId,
    display_name: opts.displayName,
    track_name: snap.trackName,
    course_name: snap.courseName,
    course_key: snap.courseKey,
    direction: isReverseCourseKey(snap.courseKey) ? "reverse" : null,
    engine: snap.engine,
    engine_key: snap.engineKey,
    listed_weight: opts.listedWeight,
    listed_weight_unit: opts.listedWeightUnit,
    lap_time_ms: snap.lapTimeMs,
    content_hash: contentHashForSnapshot(snap),
    setup_public: opts.setupPublic,
    engine_telemetry_public: opts.engineTelemetryPublic,
    data: buildEntryData(snap, {
      setupPublic: opts.setupPublic,
      engineTelemetryPublic: opts.engineTelemetryPublic,
    }),
  };
}

export async function insertEntries(rows: NewEntryRow[]): Promise<void> {
  const { error } = await leaderboardEntriesTable().insert(rows);
  if (error) throw new Error(error.message);
}

export async function withdrawEntry(id: string): Promise<void> {
  const { error } = await leaderboardEntriesTable().delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Admin ────────────────────────────────────────────────────────────────────
const ADMIN_COLUMNS = `${LIGHT_COLUMNS},class_source,admin_notes`;

/** Every entry (any status) for the admin moderation table. Admin RLS gates this. */
export async function fetchAllEntriesAdmin(): Promise<LeaderboardEntry[]> {
  const { data, error } = await leaderboardEntriesTable()
    .select(ADMIN_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as EntryRow[]).map(mapEntryRow);
}

export interface AdminEntryPatch {
  status?: "approved" | "denied";
  /** Setting/clearing a class also pins class_source so reclassify skips it. */
  engineClassId?: string | null;
  adminNotes?: string | null;
}

export async function updateEntryAdmin(id: string, patch: AdminEntryPatch): Promise<void> {
  const row: Record<string, unknown> = { reviewed_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.adminNotes !== undefined) row.admin_notes = patch.adminNotes;
  if (patch.engineClassId !== undefined) {
    row.engine_class_id = patch.engineClassId;
    row.class_source = "admin"; // manual assignment is protected from reclassify
  }
  const { error } = await leaderboardEntriesTable().update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function createEngineClass(name: string, keywords: string[], sortOrder: number): Promise<void> {
  const { error } = await engineClassesTable().insert({ name, keywords, sort_order: sortOrder });
  if (error) throw new Error(error.message);
}

export async function updateEngineClass(id: string, patch: { name?: string; keywords?: string[]; sortOrder?: number }): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.keywords !== undefined) row.keywords = patch.keywords;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  const { error } = await engineClassesTable().update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteEngineClass(id: string): Promise<void> {
  const { error } = await engineClassesTable().delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Re-run auto classification across non-admin-pinned rows; returns rows changed. */
export async function reclassifyEntries(): Promise<number> {
  const { data, error } = await untyped.rpc("reclassify_entries");
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}
