import { describe, it, expect } from "vitest";
import {
  buildOpenMeteoUrl,
  parseOpenMeteoResponse,
  parseOpenMeteoTime,
  pickNearestHourIndex,
} from "./weatherService";

describe("parseOpenMeteoTime", () => {
  it("parses an Open-Meteo UTC hour string", () => {
    const d = parseOpenMeteoTime("2025-11-04T15:00");
    expect(d?.toISOString()).toBe("2025-11-04T15:00:00.000Z");
  });
  it("returns null for garbage", () => {
    expect(parseOpenMeteoTime("nope")).toBeNull();
  });
});

describe("pickNearestHourIndex", () => {
  const times = ["2025-11-04T14:00", "2025-11-04T15:00", "2025-11-04T16:00"];
  it("finds the closest hour to the target", () => {
    expect(pickNearestHourIndex(times, new Date("2025-11-04T15:40:00Z"))).toBe(2);
    expect(pickNearestHourIndex(times, new Date("2025-11-04T15:10:00Z"))).toBe(1);
  });
  it("returns -1 when nothing parses", () => {
    expect(pickNearestHourIndex(["x", "y"], new Date())).toBe(-1);
  });
});

describe("buildOpenMeteoUrl", () => {
  const now = new Date("2025-11-20T12:00:00Z");

  it("uses the archive API for sessions older than ~5 days", () => {
    const url = buildOpenMeteoUrl(45.04, 12.23, new Date("2025-11-04T15:50:00Z"), now);
    expect(url).toContain("archive-api.open-meteo.com/v1/archive");
    expect(url).toContain("start_date=2025-11-04");
    expect(url).toContain("end_date=2025-11-04");
    expect(url).toContain("latitude=45.0400");
    expect(url).toContain("longitude=12.2300");
    expect(url).toContain("wind_speed_unit=kn");
  });

  it("uses the forecast API (past_days) for recent sessions", () => {
    const url = buildOpenMeteoUrl(45.04, 12.23, new Date("2025-11-19T08:00:00Z"), now);
    expect(url).toContain("api.open-meteo.com/v1/forecast");
    expect(url).toMatch(/past_days=\d+/);
    expect(url).toContain("forecast_days=1");
  });
});

describe("parseOpenMeteoResponse", () => {
  const json = {
    hourly: {
      time: ["2025-11-04T15:00", "2025-11-04T16:00"],
      temperature_2m: [18.3, 19.1],
      relative_humidity_2m: [64, 60],
      pressure_msl: [1018.2, 1017.5],
      surface_pressure: [1005.0, 1004.3],
      wind_speed_10m: [7.2, 9.0],
      wind_direction_10m: [210, 215],
      wind_gusts_10m: [12.4, 15.1],
    },
  };

  it("picks the nearest hour and maps fields (pressure → inHg, temp → F)", () => {
    const obs = parseOpenMeteoResponse(json, new Date("2025-11-04T15:10:00Z"))!;
    expect(obs).not.toBeNull();
    expect(obs.temperatureC).toBeCloseTo(18.3);
    expect(obs.temperatureF).toBe(65); // 18.3°C ≈ 64.9 → 65
    expect(obs.humidity).toBe(64);
    expect(obs.altimeterInHg).toBeCloseTo(1018.2 * 0.0295299830714, 2);
    expect(obs.windSpeedKts).toBe(7);
    expect(obs.windDirectionDeg).toBe(210);
    expect(obs.windGustKts).toBe(12);
    expect(obs.time.toISOString()).toBe("2025-11-04T15:00:00.000Z");
  });

  it("falls back to surface_pressure when pressure_msl is missing", () => {
    const noMsl = { hourly: { ...json.hourly, pressure_msl: [null, null] } };
    const obs = parseOpenMeteoResponse(noMsl, new Date("2025-11-04T16:00:00Z"))!;
    expect(obs.altimeterInHg).toBeCloseTo(1004.3 * 0.0295299830714, 2);
  });

  it("returns null when required fields are missing or empty", () => {
    expect(parseOpenMeteoResponse({ hourly: { time: [] } }, new Date())).toBeNull();
    expect(parseOpenMeteoResponse({}, new Date())).toBeNull();
    const noTemp = { hourly: { time: ["2025-11-04T15:00"], temperature_2m: [null], relative_humidity_2m: [60], pressure_msl: [1018] } };
    expect(parseOpenMeteoResponse(noTemp, new Date("2025-11-04T15:00:00Z"))).toBeNull();
  });
});
