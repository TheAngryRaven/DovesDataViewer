/**
 * Unit tests for the course predicates that live alongside the type
 * definitions. Both are single-source-of-truth readers — `isSprintCourse` owns
 * the "absent type means circuit" default, and `courseHasSectors` decides
 * whether any view shows sector columns at all — so their edges are worth
 * pinning independently of the callers.
 */

import { describe, it, expect } from 'vitest';
import { Course, SectorLine, courseHasSectors, isSprintCourse } from './racing';

const line = (n: number): SectorLine => ({
  a: { lat: n, lon: n },
  b: { lat: n + 0.001, lon: n + 0.001 },
});

function baseCourse(partial: Partial<Course> = {}): Course {
  return {
    name: 'Test',
    startFinishA: { lat: 0, lon: 0 },
    startFinishB: { lat: 0, lon: 0.001 },
    ...partial,
  };
}

describe('isSprintCourse', () => {
  it('is true only for an explicit sprint type', () => {
    expect(isSprintCourse(baseCourse({ type: 'sprint' }))).toBe(true);
    expect(isSprintCourse(baseCourse({ type: 'circuit' }))).toBe(false);
  });

  it('treats an absent type as circuit — every course predates the field', () => {
    expect(isSprintCourse(baseCourse())).toBe(false);
  });

  it('tolerates null/undefined', () => {
    expect(isSprintCourse(null)).toBe(false);
    expect(isSprintCourse(undefined)).toBe(false);
  });
});

describe('courseHasSectors', () => {
  it('is false without a course', () => {
    expect(courseHasSectors(null)).toBe(false);
  });

  describe('circuit', () => {
    it('needs two flagged majors alongside the implicit start/finish one', () => {
      expect(
        courseHasSectors(
          baseCourse({ sectors: [{ line: line(1), major: true }, { line: line(2), major: true }] }),
        ),
      ).toBe(true);
      expect(
        courseHasSectors(baseCourse({ sectors: [{ line: line(1), major: true }] })),
      ).toBe(false);
    });

    it('ignores sub-sectors that are not flagged major', () => {
      expect(
        courseHasSectors(
          baseCourse({
            sectors: [{ line: line(1), major: false }, { line: line(2), major: false }],
          }),
        ),
      ).toBe(false);
    });

    it('falls back to the legacy sector2/sector3 pair on un-normalized courses', () => {
      expect(courseHasSectors(baseCourse({ sector2: line(1), sector3: line(2) }))).toBe(true);
      expect(courseHasSectors(baseCourse({ sector2: line(1) }))).toBe(false);
    });
  });

  describe('sprint', () => {
    const sprint = (partial: Partial<Course> = {}) =>
      baseCourse({ type: 'sprint', finish: line(9), ...partial });

    it('counts any split, even though splits are stored unflagged', () => {
      expect(courseHasSectors(sprint({ sectors: [{ line: line(1), major: false }] }))).toBe(true);
      expect(
        courseHasSectors(
          sprint({ sectors: [{ line: line(1), major: false }, { line: line(2), major: false }] }),
        ),
      ).toBe(true);
    });

    it('is false with no splits — the whole run is one segment', () => {
      expect(courseHasSectors(sprint())).toBe(false);
      expect(courseHasSectors(sprint({ sectors: [] }))).toBe(false);
    });

    it('does not consult the legacy sector2/sector3 mirror', () => {
      expect(courseHasSectors(sprint({ sector2: line(1), sector3: line(2) }))).toBe(false);
    });
  });
});
