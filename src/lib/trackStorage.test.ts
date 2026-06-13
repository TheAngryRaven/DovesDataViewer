import { describe, it, expect } from 'vitest';
import { sectorsFromJson, sectorsToJson, type SectorJson } from './trackStorage';
import type { CourseSector } from '@/types/racing';

describe('trackStorage sector serialization', () => {
  const json: SectorJson[] = [
    { a_lat: 1, a_lng: 2, b_lat: 3, b_lng: 4, major: true },
    { a_lat: 5, a_lng: 6, b_lat: 7, b_lng: 8, major: false },
  ];
  const sectors: CourseSector[] = [
    { line: { a: { lat: 1, lon: 2 }, b: { lat: 3, lon: 4 } }, major: true },
    { line: { a: { lat: 5, lon: 6 }, b: { lat: 7, lon: 8 } }, major: false },
  ];

  it('maps the flat JSON lat/lng shape into the canonical lat/lon CourseSector model', () => {
    expect(sectorsFromJson(json)).toEqual(sectors);
  });

  it('serializes CourseSector[] back to the flat lat/lng JSON shape', () => {
    expect(sectorsToJson(sectors)).toEqual(json);
  });

  it('round-trips JSON → model → JSON without loss', () => {
    expect(sectorsToJson(sectorsFromJson(json))).toEqual(json);
  });

  it('round-trips model → JSON → model without loss', () => {
    expect(sectorsFromJson(sectorsToJson(sectors))).toEqual(sectors);
  });

  it('returns undefined for empty/missing input (both directions)', () => {
    expect(sectorsFromJson(undefined)).toBeUndefined();
    expect(sectorsFromJson([])).toBeUndefined();
    expect(sectorsToJson(undefined)).toBeUndefined();
    expect(sectorsToJson([])).toBeUndefined();
  });

  it('coerces a truthy/missing `major` flag to a strict boolean on read', () => {
    const loose = [
      { a_lat: 1, a_lng: 2, b_lat: 3, b_lng: 4 } as unknown as SectorJson, // major missing
      { a_lat: 5, a_lng: 6, b_lat: 7, b_lng: 8, major: 1 } as unknown as SectorJson, // truthy non-bool
    ];
    const out = sectorsFromJson(loose)!;
    expect(out[0].major).toBe(false);
    expect(out[1].major).toBe(true);
  });
});
