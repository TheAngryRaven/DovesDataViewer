// Shared leaderboard types (plan 0005). Kept in lib/ (not the cloud-sync plugin)
// so both the submission path (plugin) and the browse/viewer path (page + session
// builder) can depend on them without coupling to Supabase.

import type { Course, FieldMapping, GpsSample } from "@/types/racing";

/** Canonical engine-telemetry channel ids — stripped on submit unless shared. */
export const ENGINE_TELEMETRY_CHANNELS: ReadonlySet<string> = new Set([
  "rpm",
  "water_temp",
  "oil_temp",
  "egt",
  "temp_1",
  "temp_2",
]);

/** The frozen telemetry payload stored in `leaderboard_entries.data` (jsonb). */
export interface LeaderboardEntryData {
  /** Clean-lap samples (buffer trimmed); engine-telemetry stripped unless shared. */
  samples: GpsSample[];
  /** Channels present in `samples` (engine telemetry removed unless shared). */
  fieldMappings: FieldMapping[];
  /** Course geometry frozen at capture time. */
  course: Course;
  lapStartMs: number;
  lapEndMs: number;
}

/**
 * A `leaderboard_entries` row in app (camelCase) form. The light browse query
 * omits `data`; opening a group re-queries the chosen rows with it.
 */
export interface LeaderboardEntry {
  id: string;
  userId: string;
  displayName: string;
  trackName: string;
  courseName: string;
  courseKey: string;
  direction?: string | null;
  engine: string;
  engineKey: string;
  engineClassId: string | null;
  listedWeight: number | null;
  listedWeightUnit: "lb" | "kg" | null;
  lapTimeMs: number;
  contentHash: string;
  engineTelemetryPublic: boolean;
  status: "approved" | "denied";
  createdAt: string;
  /** Admin-only fields (present when loaded through the admin view). */
  classSource?: "auto" | "admin";
  adminNotes?: string | null;
  /** Only present once a group is opened (heavy payload). */
  data?: LeaderboardEntryData;
}

/** An admin-managed engine classification group. */
export interface EngineClass {
  id: string;
  name: string;
  keywords: string[];
  sortOrder: number;
}
