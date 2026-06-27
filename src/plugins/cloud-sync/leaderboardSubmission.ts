// Pure leaderboard-submission logic (plan 0005): content hashing + payload
// building (privacy stripping). No Supabase / React here so it stays unit-testable;
// the client (leaderboardClient.ts) and panel wire it to the network + UI.

import type { GpsSample } from "@/types/racing";
import { fnv1a } from "@/lib/fnv1a";
import { snapshotLapSamples, type LapSnapshot } from "@/lib/lapSnapshot";
import { ENGINE_TELEMETRY_CHANNELS, type LeaderboardEntryData } from "@/lib/leaderboardTypes";

/**
 * Stable content hash of a snapshot's immutable identity, used as the per-user
 * anti-resubmit key (mirrors the DB `unique (user_id, content_hash)`). Built from
 * fields that never change for a given captured lap — lap time, recording time,
 * course key, sample count, and the first/last coordinates.
 */
export function contentHashForSnapshot(snap: LapSnapshot): string {
  const clean = snapshotLapSamples(snap);
  const first = clean[0];
  const last = clean[clean.length - 1];
  const coord = (s: GpsSample | undefined): string =>
    s ? `${s.lat.toFixed(6)},${s.lon.toFixed(6)}` : "";
  return fnv1a(
    [
      snap.courseKey,
      snap.lapTimeMs,
      snap.recordedAt ?? 0,
      clean.length,
      coord(first),
      coord(last),
    ].join("|"),
  );
}

export interface BuildEntryOptions {
  engineTelemetryPublic: boolean;
}

/**
 * Build the frozen `data` payload for a leaderboard entry, applying privacy:
 * engine-telemetry channels are stripped from both the samples' `extraFields` and
 * the `fieldMappings` unless shared. Setup data is never included. GPS, speed, and
 * everything else stay. Always trims to the clean lap (no buffer).
 */
export function buildEntryData(snap: LapSnapshot, opts: BuildEntryOptions): LeaderboardEntryData {
  const clean = snapshotLapSamples(snap);
  const stripTelemetry = !opts.engineTelemetryPublic;

  const samples: GpsSample[] = clean.map((s) => {
    if (!stripTelemetry) return { ...s };
    const extraFields: Record<string, number> = {};
    for (const [k, v] of Object.entries(s.extraFields)) {
      if (!ENGINE_TELEMETRY_CHANNELS.has(k)) extraFields[k] = v;
    }
    return { ...s, extraFields };
  });

  // The snapshot doesn't carry its own fieldMappings; derive the channel list from
  // the surviving extraFields keys (union across samples). Engine telemetry is
  // already excluded above when not shared.
  const channelNames = new Set<string>();
  for (const s of samples) {
    for (const k of Object.keys(s.extraFields)) channelNames.add(k);
  }
  const fieldMappings = Array.from(channelNames).map((name, index) => ({
    index,
    name,
    enabled: true,
  }));

  return {
    samples,
    fieldMappings,
    course: snap.course,
    lapStartMs: snap.lapStartMs,
    lapEndMs: snap.lapEndMs,
  };
}

/** Resolve the default listed weight for a snapshot (the vehicle weight, if any). */
export function defaultListedWeight(snap: LapSnapshot): { weight: number | null; unit: "lb" | "kg" } {
  const w = snap.vehicle?.weight;
  return {
    weight: typeof w === "number" && w > 0 ? w : null,
    unit: snap.vehicle?.weightUnit ?? "lb",
  };
}

/** A listed weight is valid for submission when it's a positive number. */
export function isValidListedWeight(weight: number | null | undefined): weight is number {
  return typeof weight === "number" && Number.isFinite(weight) && weight > 0;
}
