import { describe, it, expect } from "vitest";
import { buildGoProSession, rowsFromPayloads, type GoProPayload } from "./goproTelemetry";
import { acclOnlyPayload, gps5Payload, gps9Payload } from "./testFixtures";
import { parseDoveFile } from "@/lib/doveParser";

const buf = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const UTC = Date.UTC(2024, 5, 15, 14, 30, 25, 0);

function payload(bytes: Uint8Array, timeSec: number, durationSec = 1): GoProPayload {
  return { data: buf(bytes), timeSec, durationSec };
}

describe("rowsFromPayloads", () => {
  it("spreads GPS5 fixes evenly across the payload and inherits GPSU time", () => {
    const fixes = Array.from({ length: 4 }, (_, i) => ({ lat: 33.5 + i * 1e-4, lon: -117.7, alt: 100, speed2d: 10 }));
    const rows = rowsFromPayloads([payload(gps5Payload(fixes, { gpsu: "240615143025.000" }), 2, 1)]);
    expect(rows.map((r) => r.tSec)).toEqual([2, 2.25, 2.5, 2.75]);
    expect(rows.map((r) => r.utcMs)).toEqual([UTC, UTC + 250, UTC + 500, UTC + 750]);
    expect(rows[0].dop).toBeCloseTo(1.5, 5);
  });

  it("drops whole GPS5 payloads without a lock, and GPS9 samples individually", () => {
    const unlocked = rowsFromPayloads([payload(gps5Payload([{ lat: 33.5, lon: -117.7, alt: 0, speed2d: 0 }], { fix: 0 }), 0)]);
    expect(unlocked).toEqual([]);
    const gps9 = gps9Payload([
      { lat: 33.5, lon: -117.7, alt: 1, speed2d: 1, utcMs: UTC, dop: 1, fix: 3 },
      { lat: 33.5, lon: -117.7, alt: 1, speed2d: 1, utcMs: UTC + 100, dop: 1, fix: 0 },
      { lat: 33.5, lon: -117.7, alt: 1, speed2d: 1, utcMs: UTC + 200, dop: 1, fix: 2 },
    ]);
    const rows = rowsFromPayloads([payload(gps9, 5, 0.3)]);
    expect(rows.map((r) => r.utcMs)).toEqual([UTC, UTC + 200]);
    expect(rows.map((r) => r.tSec)).toEqual([5, 5.2]);
  });

  it("rejects zero/out-of-range coordinates and skips payloads without GPS", () => {
    const rows = rowsFromPayloads([
      payload(gps5Payload([{ lat: 0, lon: 0, alt: 0, speed2d: 0 }, { lat: 95, lon: 10, alt: 0, speed2d: 0 }, { lat: 33.5, lon: -117.7, alt: 0, speed2d: 1 }]), 0),
      payload(acclOnlyPayload(), 1),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].tSec).toBeCloseTo(2 / 3, 6);
  });

  it("offsets a later chapter by the chapters before it", () => {
    const rows = rowsFromPayloads([payload(gps5Payload([{ lat: 33.5, lon: -117.7, alt: 0, speed2d: 1 }]), 1)], 600);
    expect(rows[0].tSec).toBe(601);
  });
});

describe("buildGoProSession", () => {
  const rows = [
    { tSec: 3.5, lat: 33.5, lon: -117.7, altitudeM: 100, speedMps: 10, dop: 1.5, utcMs: UTC },
    { tSec: 4, lat: 33.5001, lon: -117.7001, altitudeM: 101, speedMps: 20, dop: 1.6, utcMs: UTC + 500 },
  ];

  it("writes a Dove CSV anchored on the first UTC fix, with the known video sync offset", () => {
    const session = buildGoProSession(rows);
    expect(session.rowCount).toBe(2);
    expect(session.startEpochMs).toBe(UTC);
    expect(session.syncOffsetMs).toBe(-3500);
    const lines = session.csv.trim().split("\n");
    expect(lines[0]).toBe("timestamp,lat,lng,speed_mph,altitude_m,hdop");
    expect(lines[1]).toBe(`${UTC},33.5000000,-117.7000000,22.37,100.00,1.50`);
    expect(lines[2].startsWith(`${UTC + 500},`)).toBe(true);
  });

  it("produces a file the Dove parser opens with HDOP and altitude channels", () => {
    const parsed = parseDoveFile(buildGoProSession(rows).csv);
    expect(parsed.samples).toHaveLength(2);
    expect(parsed.samples[1].t).toBe(500);
    expect(parsed.samples[0].speedMps).toBeCloseTo(10, 1);
    expect(parsed.samples[0].extraFields).toMatchObject({ HDOP: 1.5, Altitude: 100 });
    expect(parsed.startDate?.getTime()).toBe(UTC);
  });

  it("falls back to the container creation time when no fix carries UTC", () => {
    const dateless = rows.map(({ utcMs: _utc, ...r }) => r);
    const session = buildGoProSession(dateless, 1_700_000_000_000);
    expect(session.startEpochMs).toBe(1_700_000_000_000);
    expect(() => buildGoProSession(dateless)).toThrow(/no GPS time/);
  });

  it("keeps timestamps strictly increasing when rows collide after rounding", () => {
    const session = buildGoProSession([
      { ...rows[0], tSec: 1 }, { ...rows[0], tSec: 1.0001 }, { ...rows[0], tSec: 1.0002 },
    ]);
    const stamps = session.csv.trim().split("\n").slice(1).map((l) => Number(l.split(",")[0]));
    expect(stamps).toEqual([UTC, UTC + 1, UTC + 2]);
  });

  it("throws when nothing survived", () => {
    expect(() => buildGoProSession([])).toThrow(/satellite lock/);
  });
});
