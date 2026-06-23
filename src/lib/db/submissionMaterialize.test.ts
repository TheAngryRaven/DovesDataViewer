import { describe, it, expect } from 'vitest';
import { buildCourseColumnsFromSubmission } from './submissionMaterialize';
import type { DbSubmission } from './types';

function makeSubmission(overrides: Partial<DbSubmission> = {}): DbSubmission {
  return {
    id: 'sub-1',
    type: 'new_track',
    track_name: 'Test Raceway',
    track_short_name: 'TSTRW',
    course_name: 'Main',
    course_data: {
      start_a_lat: 40.1,
      start_a_lng: -80.1,
      start_b_lat: 40.2,
      start_b_lng: -80.2,
    },
    status: 'pending',
    submitted_by_ip: null,
    submitted_by_user_id: null,
    batch_id: null,
    created_at: '2026-06-01T00:00:00Z',
    reviewed_at: null,
    reviewed_by: null,
    review_notes: null,
    ...overrides,
  };
}

describe('buildCourseColumnsFromSubmission', () => {
  it('builds the start/finish columns from course_data', () => {
    const cols = buildCourseColumnsFromSubmission(makeSubmission());
    expect(cols.name).toBe('Main');
    expect(cols.enabled).toBe(true);
    expect(cols.start_a_lat).toBe(40.1);
    expect(cols.start_a_lng).toBe(-80.1);
    expect(cols.start_b_lat).toBe(40.2);
    expect(cols.start_b_lng).toBe(-80.2);
    expect(cols.superseded_by).toBeNull();
    expect(cols.sectors_data).toBeNull();
    expect(cols.length_ft_override).toBeNull();
  });

  it('trims the course name', () => {
    const cols = buildCourseColumnsFromSubmission(makeSubmission({ course_name: '  Outer  ' }));
    expect(cols.name).toBe('Outer');
  });

  it('carries the legacy two-major sector columns', () => {
    const cols = buildCourseColumnsFromSubmission(makeSubmission({
      course_data: {
        start_a_lat: 1, start_a_lng: 2, start_b_lat: 3, start_b_lng: 4,
        sector_2_a_lat: 5, sector_2_a_lng: 6, sector_2_b_lat: 7, sector_2_b_lng: 8,
        sector_3_a_lat: 9, sector_3_a_lng: 10, sector_3_b_lat: 11, sector_3_b_lng: 12,
      },
    }));
    expect(cols.sector_2_a_lat).toBe(5);
    expect(cols.sector_3_b_lng).toBe(12);
  });

  it('leaves omitted sector columns null', () => {
    const cols = buildCourseColumnsFromSubmission(makeSubmission());
    expect(cols.sector_2_a_lat).toBeNull();
    expect(cols.sector_3_b_lng).toBeNull();
  });

  it('prefers the dedicated sectors_data column', () => {
    const sectors = [
      { a_lat: 1, a_lng: 2, b_lat: 3, b_lng: 4, major: true },
      { a_lat: 5, a_lng: 6, b_lat: 7, b_lng: 8, major: false },
    ];
    const cols = buildCourseColumnsFromSubmission(makeSubmission({ sectors_data: sectors }));
    expect(cols.sectors_data).toEqual(sectors);
  });

  it('falls back to course_data.sectors when no dedicated column', () => {
    const cols = buildCourseColumnsFromSubmission(makeSubmission({
      course_data: {
        start_a_lat: 1, start_a_lng: 2, start_b_lat: 3, start_b_lng: 4,
        sectors: [{ a_lat: 1, a_lng: 2, b_lat: 3, b_lng: 4, major: true }],
      },
    }));
    expect(cols.sectors_data).toEqual([{ a_lat: 1, a_lng: 2, b_lat: 3, b_lng: 4, major: true }]);
  });

  it('coerces the major flag to a boolean', () => {
    const cols = buildCourseColumnsFromSubmission(makeSubmission({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally loose input
      sectors_data: [{ a_lat: 1, a_lng: 2, b_lat: 3, b_lng: 4, major: 1 as any }],
    }));
    expect(cols.sectors_data?.[0].major).toBe(true);
  });

  it('rounds lengthFt into length_ft_override', () => {
    const cols = buildCourseColumnsFromSubmission(makeSubmission({
      course_data: { start_a_lat: 1, start_a_lng: 2, start_b_lat: 3, start_b_lng: 4, lengthFt: 1234.6 },
    }));
    expect(cols.length_ft_override).toBe(1235);
  });

  it('ignores a non-positive lengthFt', () => {
    const cols = buildCourseColumnsFromSubmission(makeSubmission({
      course_data: { start_a_lat: 1, start_a_lng: 2, start_b_lat: 3, start_b_lng: 4, lengthFt: 0 },
    }));
    expect(cols.length_ft_override).toBeNull();
  });

  it('throws on an out-of-range latitude', () => {
    expect(() => buildCourseColumnsFromSubmission(makeSubmission({
      course_data: { start_a_lat: 200, start_a_lng: 2, start_b_lat: 3, start_b_lng: 4 },
    }))).toThrow(/latitude/i);
  });

  it('throws on an out-of-range longitude', () => {
    expect(() => buildCourseColumnsFromSubmission(makeSubmission({
      course_data: { start_a_lat: 1, start_a_lng: 999, start_b_lat: 3, start_b_lng: 4 },
    }))).toThrow(/longitude/i);
  });

  it('throws on a non-finite coordinate', () => {
    expect(() => buildCourseColumnsFromSubmission(makeSubmission({
      course_data: { start_a_lat: 'abc', start_a_lng: 2, start_b_lat: 3, start_b_lng: 4 },
    }))).toThrow();
  });

  it('throws on a blank course name', () => {
    expect(() => buildCourseColumnsFromSubmission(makeSubmission({ course_name: '   ' }))).toThrow(/course name/i);
  });

  it('validates sector coordinates too', () => {
    expect(() => buildCourseColumnsFromSubmission(makeSubmission({
      sectors_data: [{ a_lat: 91, a_lng: 2, b_lat: 3, b_lng: 4, major: true }],
    }))).toThrow(/latitude/i);
  });
});
