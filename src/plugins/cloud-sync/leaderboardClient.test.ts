import { describe, it, expect, vi } from "vitest";
import type { Course } from "@/types/racing";
import type { LapSnapshot } from "@/lib/lapSnapshot";

// The real supabase client calls createClient() at import time (needs localStorage,
// absent in node). Stub it so buildNewEntryRow (a pure helper) is testable.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({}), storage: { from: () => ({}) }, rpc: async () => ({ data: null, error: null }) },
}));

import { buildNewEntryRow } from "./leaderboardClient";

const course: Course = {
  name: "Full CW",
  startFinishA: { lat: 35, lon: -97 },
  startFinishB: { lat: 35, lon: -97.001 },
};

function snap(): LapSnapshot {
  return {
    id: "s1", trackName: "OKC", courseName: "Full CW", courseKey: "OKCFull CW",
    engine: "Rotax", engineKey: "rotax", course,
    lapTimeMs: 55603.51768562128, // fractional — the integer column rejects this raw
    sourceFileName: "s.dove", sourceLapNumber: 2,
    samples: [
      { t: 0, lat: 35, lon: -97, speedMps: 20, speedMph: 44, speedKph: 72, extraFields: {} },
      { t: 1000, lat: 35.001, lon: -97.001, speedMps: 20, speedMph: 44, speedKph: 72, extraFields: {} },
    ],
    lapStartMs: 0, lapEndMs: 1000,
    vehicle: { id: "v", name: "k", number: 1, weight: 365, weightUnit: "lb" },
    createdAt: 1, updatedAt: 1,
  };
}

describe("buildNewEntryRow", () => {
  it("rounds lap_time_ms to an integer (the column type)", () => {
    const row = buildNewEntryRow(snap(), {
      userId: "u1", displayName: "Bob", setupPublic: false, engineTelemetryPublic: false,
      listedWeight: 365, listedWeightUnit: "lb",
    });
    expect(row.lap_time_ms).toBe(55604);
    expect(Number.isInteger(row.lap_time_ms)).toBe(true);
  });
});
