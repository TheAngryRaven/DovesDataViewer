/**
 * These two helpers exist because the sprint finish line was rendered in the
 * track editor and nowhere else — the race-line map and the sim map each had
 * their own hardcoded start/finish colour and no concept of a finish line at
 * all. Pinning the rules here is what stops the next map view drifting the
 * same way.
 */

import { describe, it, expect } from 'vitest';
import { Course, SectorLine } from '@/types/racing';
import { COURSE_LINE_COLORS, finishLineOf, openingLineColor } from './courseLineStyle';

const finish: SectorLine = {
  a: { lat: 1, lon: 2 },
  b: { lat: 3, lon: 4 },
};

function course(partial: Partial<Course> = {}): Course {
  return {
    name: 'Test',
    startFinishA: { lat: 0, lon: 0 },
    startFinishB: { lat: 0, lon: 0.001 },
    ...partial,
  };
}

describe('openingLineColor', () => {
  it('keeps the existing red for a circuit — one line doing both jobs', () => {
    expect(openingLineColor(course())).toBe(COURSE_LINE_COLORS.startFinish);
    expect(openingLineColor(course({ type: 'circuit' }))).toBe(COURSE_LINE_COLORS.startFinish);
  });

  it('is green on a sprint course, so start and finish are distinguishable', () => {
    expect(openingLineColor(course({ type: 'sprint', finish }))).toBe(
      COURSE_LINE_COLORS.sprintStart,
    );
    // Green-to-red only reads as start-to-end if the two differ.
    expect(COURSE_LINE_COLORS.sprintStart).not.toBe(COURSE_LINE_COLORS.finish);
  });

  it('treats an absent course or type as circuit', () => {
    expect(openingLineColor(null)).toBe(COURSE_LINE_COLORS.startFinish);
    expect(openingLineColor(undefined)).toBe(COURSE_LINE_COLORS.startFinish);
  });
});

describe('finishLineOf', () => {
  it('returns the finish line of a sprint course', () => {
    expect(finishLineOf(course({ type: 'sprint', finish }))).toEqual(finish);
  });

  it('returns null for a sprint course that has no finish line yet', () => {
    expect(finishLineOf(course({ type: 'sprint' }))).toBeNull();
  });

  it('ignores a stray finish line on a circuit course', () => {
    // Left over from a course that was retyped — stale data, not a line to
    // draw, and drawing it would put a phantom red line on a circuit map.
    expect(finishLineOf(course({ finish }))).toBeNull();
    expect(finishLineOf(course({ type: 'circuit', finish }))).toBeNull();
  });

  it('tolerates no course at all', () => {
    expect(finishLineOf(null)).toBeNull();
    expect(finishLineOf(undefined)).toBeNull();
  });
});
