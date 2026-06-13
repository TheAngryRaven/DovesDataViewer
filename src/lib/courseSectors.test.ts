import { describe, it, expect } from 'vitest';
import { Course, SectorLine } from '@/types/racing';
import {
  normalizeCourseSectors, majorSectorLines, legacyMirror, sectorLabels,
  validateCourseSectors, isAtSectorLimit, rollupMajorSectors,
  MAX_SECTOR_LINES, MAX_MAJOR_SECTORS,
} from './courseSectors';

const line = (n: number): SectorLine => ({ a: { lat: n, lon: n }, b: { lat: n + 0.001, lon: n + 0.001 } });

function baseCourse(partial: Partial<Course> = {}): Course {
  return {
    name: 'Test',
    startFinishA: { lat: 0, lon: 0 },
    startFinishB: { lat: 0, lon: 0.001 },
    ...partial,
  };
}

describe('normalizeCourseSectors', () => {
  it('migrates legacy sector2/sector3 into two major sectors', () => {
    const c = normalizeCourseSectors(baseCourse({ sector2: line(1), sector3: line(2) }));
    expect(c.sectors).toHaveLength(2);
    expect(c.sectors!.every((s) => s.major)).toBe(true);
    expect(c.sectors![0].line).toEqual(line(1));
    // Legacy mirror is kept in agreement.
    expect(c.sector2).toEqual(line(1));
    expect(c.sector3).toEqual(line(2));
  });

  it('leaves a course with no sectors untouched', () => {
    const c = normalizeCourseSectors(baseCourse());
    expect(c.sectors).toBeUndefined();
    expect(c.sector2).toBeUndefined();
  });

  it('is idempotent', () => {
    const once = normalizeCourseSectors(baseCourse({ sector2: line(1), sector3: line(2) }));
    const twice = normalizeCourseSectors(once);
    expect(twice.sectors).toEqual(once.sectors);
    expect(twice.sector2).toEqual(once.sector2);
  });

  it('re-derives the legacy mirror from the first two majors', () => {
    const c = normalizeCourseSectors(baseCourse({
      sectors: [
        { line: line(1), major: false },
        { line: line(2), major: true },
        { line: line(3), major: false },
        { line: line(4), major: true },
      ],
    }));
    const { sector2, sector3 } = legacyMirror(c);
    expect(sector2).toEqual(line(2));
    expect(sector3).toEqual(line(4));
  });
});

describe('majorSectorLines', () => {
  it('returns only the major lines in order', () => {
    const c = baseCourse({
      sectors: [
        { line: line(1), major: false },
        { line: line(2), major: true },
        { line: line(3), major: true },
      ],
    });
    expect(majorSectorLines(c)).toEqual([line(2), line(3)]);
  });
});

describe('sectorLabels', () => {
  it('numbers majors as groups and sub-sectors as group.n', () => {
    const c = baseCourse({
      sectors: [
        { line: line(1), major: false }, // 1.1
        { line: line(2), major: true },  // 2
        { line: line(3), major: false }, // 2.1
        { line: line(4), major: false }, // 2.2
        { line: line(5), major: true },  // 3
      ],
    });
    expect(sectorLabels(c)).toEqual(['1', '1.1', '2', '2.1', '2.2', '3']);
  });

  it('labels a bare course as just start/finish', () => {
    expect(sectorLabels(baseCourse())).toEqual(['1']);
  });
});

describe('validateCourseSectors', () => {
  it('accepts a course with no extra sectors', () => {
    expect(validateCourseSectors(baseCourse()).valid).toBe(true);
  });

  it('accepts exactly three majors (start/finish + two)', () => {
    const c = baseCourse({ sectors: [{ line: line(1), major: true }, { line: line(2), major: true }] });
    expect(validateCourseSectors(c).valid).toBe(true);
  });

  it('rejects sectors with the wrong number of majors', () => {
    const c = baseCourse({ sectors: [{ line: line(1), major: false }, { line: line(2), major: true }] });
    const v = validateCourseSectors(c);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/three traditional sectors/i);
  });

  it('rejects exceeding the timing-line cap', () => {
    const many = Array.from({ length: MAX_SECTOR_LINES }, (_, i) => ({ line: line(i), major: i < MAX_MAJOR_SECTORS - 1 }));
    const c = baseCourse({ sectors: many });
    expect(validateCourseSectors(c).valid).toBe(false);
  });
});

describe('isAtSectorLimit', () => {
  it('is true once the course holds MAX_SECTOR_LINES - 1 sectors', () => {
    const sectors = Array.from({ length: MAX_SECTOR_LINES - 1 }, (_, i) => ({ line: line(i), major: false }));
    expect(isAtSectorLimit(baseCourse({ sectors }))).toBe(true);
    expect(isAtSectorLimit(baseCourse({ sectors: sectors.slice(0, -1) }))).toBe(false);
  });
});

describe('rollupMajorSectors', () => {
  // Course: S/F, sub(1.1), major(2), sub(2.1), major(3) → 5 timing lines.
  const course = baseCourse({
    sectors: [
      { line: line(1), major: false },
      { line: line(2), major: true },
      { line: line(3), major: false },
      { line: line(4), major: true },
    ],
  });

  it('sums fine-grained segments into the three major sectors', () => {
    // segments: [S/F→1.1, 1.1→2, 2→2.1, 2.1→3, 3→S/F]
    const times = [1000, 2000, 3000, 4000, 5000];
    const roll = rollupMajorSectors(course, times)!;
    expect(roll.s1).toBe(3000);  // 1000 + 2000 (S/F group up to major 2)
    expect(roll.s2).toBe(7000);  // 3000 + 4000 (major 2 group up to major 3)
    expect(roll.s3).toBe(5000);  // 5000 (major 3 group to S/F)
  });

  it('marks a major sector undefined when one of its segments is missing', () => {
    const times = [1000, undefined, 3000, 4000, 5000];
    const roll = rollupMajorSectors(course, times)!;
    expect(roll.s1).toBeUndefined();
    expect(roll.s2).toBe(7000);
    expect(roll.s3).toBe(5000);
  });

  it('returns undefined when there are fewer than three majors', () => {
    const c = baseCourse({ sectors: [{ line: line(1), major: true }] });
    expect(rollupMajorSectors(c, [1000, 2000])).toBeUndefined();
  });
});
