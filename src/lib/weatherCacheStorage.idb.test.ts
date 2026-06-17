/**
 * IndexedDB round-trip tests for weatherCacheStorage: a session's historical
 * weather is cached locally and keyed by file name, so reopening never re-pings
 * the weather station/API.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import {
  getCachedWeather,
  saveCachedWeather,
  deleteCachedWeather,
} from "./weatherCacheStorage";
import type { WeatherData } from "./weatherService";

beforeEach(() => freshIndexedDB());

function sampleWeather(overrides: Partial<WeatherData> = {}): WeatherData {
  return {
    station: { stationId: "KOKC", name: "Oklahoma City", distanceKm: 4.2, source: "asos" },
    temperatureF: 75,
    temperatureC: 23.9,
    humidity: 55,
    altimeterInHg: 29.92,
    densityAltitudeFt: 1500,
    windSpeedKts: 8,
    windDirectionDeg: 180,
    windGustKts: null,
    observationTime: new Date("2026-03-15T19:30:00Z"),
    ...overrides,
  };
}

describe("weatherCacheStorage round-trip", () => {
  it("returns null when nothing is cached for the session", async () => {
    expect(await getCachedWeather("none.dove")).toBeNull();
  });

  it("saves and loads a session's weather, preserving the observation Date", async () => {
    const data = sampleWeather();
    await saveCachedWeather("s.dove", data);
    const loaded = await getCachedWeather("s.dove");
    expect(loaded).not.toBeNull();
    expect(loaded!.temperatureF).toBe(75);
    expect(loaded!.station.stationId).toBe("KOKC");
    expect(loaded!.observationTime).toBeInstanceOf(Date);
    expect(loaded!.observationTime.getTime()).toBe(new Date("2026-03-15T19:30:00Z").getTime());
  });

  it("is scoped per session file name", async () => {
    await saveCachedWeather("a.dove", sampleWeather({ temperatureF: 60 }));
    await saveCachedWeather("b.dove", sampleWeather({ temperatureF: 90 }));
    expect((await getCachedWeather("a.dove"))!.temperatureF).toBe(60);
    expect((await getCachedWeather("b.dove"))!.temperatureF).toBe(90);
  });

  it("upserts in place on re-save", async () => {
    await saveCachedWeather("s.dove", sampleWeather({ temperatureF: 60 }));
    await saveCachedWeather("s.dove", sampleWeather({ temperatureF: 72 }));
    expect((await getCachedWeather("s.dove"))!.temperatureF).toBe(72);
  });

  it("deletes a session's cached weather", async () => {
    await saveCachedWeather("s.dove", sampleWeather());
    await deleteCachedWeather("s.dove");
    expect(await getCachedWeather("s.dove")).toBeNull();
  });

  it("ignores empty file names without throwing", async () => {
    await saveCachedWeather("", sampleWeather());
    expect(await getCachedWeather("")).toBeNull();
    await expect(deleteCachedWeather("")).resolves.toBeUndefined();
  });
});
