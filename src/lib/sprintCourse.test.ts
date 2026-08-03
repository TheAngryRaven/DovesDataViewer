import { describe, it, expect } from 'vitest';
import { Course } from '@/types/racing';
import {
  formatSprintDateCreated,
  isValidSprintDateCreated,
  stampSprintDateCreated,
  newestSprintCourse,
  newestSprintCourseIndex,
} from './sprintCourse';

function sprint(name: string, dateCreated?: string): Course {
  return {
    name,
    type: 'sprint',
    startFinishA: { lat: 0, lon: 0 },
    startFinishB: { lat: 0, lon: 1 },
    finish: { a: { lat: 1, lon: 0 }, b: { lat: 1, lon: 1 } },
    dateCreated,
  };
}

function circuit(name: string): Course {
  return {
    name,
    startFinishA: { lat: 0, lon: 0 },
    startFinishB: { lat: 0, lon: 1 },
  };
}

describe('formatSprintDateCreated', () => {
  it('formats as zero-padded YYYY-MM-DDTHH:MM in local time', () => {
    // Month is 0-based in the Date constructor: 8 = September.
    expect(formatSprintDateCreated(new Date(2026, 8, 5, 7, 3))).toBe('2026-09-05T07:03');
  });

  it('zero-pads every field so stamps stay the same width', () => {
    expect(formatSprintDateCreated(new Date(2026, 0, 1, 0, 0))).toHaveLength(16);
    expect(formatSprintDateCreated(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31T23:59');
  });

  it('produces stamps that sort chronologically as plain strings', () => {
    // This is the whole contract with the firmware: it compares these with a
    // string compare, never a date parse.
    const stamps = [
      new Date(2026, 8, 5, 9, 0),
      new Date(2026, 8, 5, 10, 0),   // 10 must sort AFTER 9, not before
      new Date(2026, 9, 1, 8, 0),    // October after September
      new Date(2027, 0, 1, 0, 0),
    ].map(formatSprintDateCreated);

    expect([...stamps].sort()).toEqual(stamps);
  });
});

describe('isValidSprintDateCreated', () => {
  it('accepts the exact device shape', () => {
    expect(isValidSprintDateCreated('2026-09-05T07:03')).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['no zero padding', '2026-9-5T7:03'],
    ['US ordering', '09/05/2026 07:03'],
    ['full ISO instant with seconds', '2026-09-05T07:03:00'],
    ['zoned ISO instant', '2026-09-05T07:03:00Z'],
    ['date only', '2026-09-05'],
  ])('rejects %s', (_label, value) => {
    expect(isValidSprintDateCreated(value as string | undefined)).toBe(false);
  });
});

describe('stampSprintDateCreated', () => {
  it('stamps an unstamped sprint course', () => {
    const out = stampSprintDateCreated(sprint('Run 1'), new Date(2026, 8, 5, 7, 3));
    expect(out.dateCreated).toBe('2026-09-05T07:03');
  });

  it('preserves an existing stamp so an edit cannot jump the device queue', () => {
    const original = sprint('Run 1', '2026-09-05T07:03');
    const out = stampSprintDateCreated(original, new Date(2027, 0, 1, 12, 0));
    expect(out.dateCreated).toBe('2026-09-05T07:03');
  });

  it('replaces a malformed stamp, which would collate wrong on the device', () => {
    const out = stampSprintDateCreated(sprint('Run 1', '9/5/2026'), new Date(2026, 8, 5, 7, 3));
    expect(out.dateCreated).toBe('2026-09-05T07:03');
  });

  it('leaves circuit courses untouched', () => {
    const c = circuit('Full Course');
    expect(stampSprintDateCreated(c, new Date(2026, 8, 5, 7, 3))).toBe(c);
  });

  it('does not mutate its input', () => {
    const original = sprint('Run 1');
    stampSprintDateCreated(original, new Date(2026, 8, 5, 7, 3));
    expect(original.dateCreated).toBeUndefined();
  });
});

describe('newestSprintCourseIndex', () => {
  it('returns -1 when there are no courses at all', () => {
    expect(newestSprintCourseIndex([])).toBe(-1);
  });

  it('returns -1 when no course is a sprint course', () => {
    expect(newestSprintCourseIndex([circuit('A'), circuit('B')])).toBe(-1);
  });

  it('picks the newest stamp, not the last in the array', () => {
    const courses = [
      sprint('Morning', '2026-09-05T08:00'),
      sprint('Afternoon', '2026-09-05T14:30'),
      sprint('Midday', '2026-09-05T11:15'),
    ];
    expect(newestSprintCourseIndex(courses)).toBe(1);
    expect(newestSprintCourse(courses)?.name).toBe('Afternoon');
  });

  it('orders by string compare, so 10:00 beats 09:00', () => {
    // The naive-sort trap: without zero padding "9:00" > "10:00" lexically.
    const courses = [sprint('Nine', '2026-09-05T09:00'), sprint('Ten', '2026-09-05T10:00')];
    expect(newestSprintCourse(courses)?.name).toBe('Ten');
  });

  it('ignores circuit courses when choosing', () => {
    const courses = [circuit('Full Course'), sprint('Run', '2026-09-05T08:00')];
    expect(newestSprintCourseIndex(courses)).toBe(1);
  });

  it('sorts an unstamped sprint course oldest rather than dropping it', () => {
    const courses = [sprint('Unstamped'), sprint('Stamped', '2020-01-01T00:00')];
    // Even a very old real stamp beats no stamp.
    expect(newestSprintCourse(courses)?.name).toBe('Stamped');
  });

  it('still returns an unstamped course when it is the only candidate', () => {
    // The device would see the file either way; hiding it here would make the
    // app disagree with the card.
    const courses = [circuit('Full Course'), sprint('Unstamped')];
    expect(newestSprintCourse(courses)?.name).toBe('Unstamped');
  });

  it('treats a malformed stamp as unstamped', () => {
    const courses = [sprint('Bad', '9/5/2026'), sprint('Good', '2020-01-01T00:00')];
    expect(newestSprintCourse(courses)?.name).toBe('Good');
  });

  it('keeps the earlier course on a tie', () => {
    const courses = [sprint('First', '2026-09-05T08:00'), sprint('Second', '2026-09-05T08:00')];
    expect(newestSprintCourseIndex(courses)).toBe(0);
  });
});
