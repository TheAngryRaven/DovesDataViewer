import { describe, it, expect } from 'vitest';
import type { Course, Track } from '@/types/racing';
import {
  buildSubmissionPlan,
  courseContentHash,
  courseToSubmissionData,
  mergeSubmittedRecords,
  pendingCourses,
  submissionKey,
  type SubmittedRecord,
} from './trackSubmission';

function course(name: string, overrides: Partial<Course> = {}): Course {
  return {
    name,
    startFinishA: { lat: 28.41, lon: -81.38 },
    startFinishB: { lat: 28.42, lon: -81.39 },
    ...overrides,
  };
}

const sectors = {
  sector2: { a: { lat: 28.411, lon: -81.381 }, b: { lat: 28.412, lon: -81.382 } },
  sector3: { a: { lat: 28.413, lon: -81.383 }, b: { lat: 28.414, lon: -81.384 } },
};

describe('courseToSubmissionData', () => {
  it('emits the flat start/finish payload without sectors', () => {
    const d = courseToSubmissionData(course('A'));
    expect(d).toEqual({
      start_a_lat: 28.41, start_a_lng: -81.38,
      start_b_lat: 28.42, start_b_lng: -81.39,
    });
    expect(d.sector_2_a_lat).toBeUndefined();
  });

  it('includes sector lines only when both sector2 and sector3 are present', () => {
    const withBoth = courseToSubmissionData(course('A', sectors));
    expect(withBoth.sector_2_a_lat).toBe(28.411);
    expect(withBoth.sector_3_b_lng).toBe(-81.384);

    // sector2 alone is dropped (matches the rest of the codebase's contract)
    const withOne = courseToSubmissionData(course('A', { sector2: sectors.sector2 }));
    expect(withOne.sector_2_a_lat).toBeUndefined();
  });
});

describe('courseContentHash', () => {
  it('is stable for identical geometry and ignores the course name', () => {
    expect(courseContentHash(course('A'))).toBe(courseContentHash(course('B')));
  });

  it('changes when a coordinate moves beyond rounding precision', () => {
    const moved = course('A', { startFinishA: { lat: 28.4105, lon: -81.38 } });
    expect(courseContentHash(moved)).not.toBe(courseContentHash(course('A')));
  });

  it('is unaffected by sub-7th-decimal float noise', () => {
    const noisy = course('A', { startFinishA: { lat: 28.41 + 1e-9, lon: -81.38 } });
    expect(courseContentHash(noisy)).toBe(courseContentHash(course('A')));
  });

  it('changes when sectors are added', () => {
    expect(courseContentHash(course('A', sectors))).not.toBe(courseContentHash(course('A')));
  });

  it('changes when a drawing is added or edited', () => {
    const drawn = course('A', { layout: [{ lat: 28.41, lon: -81.38 }, { lat: 28.42, lon: -81.39 }] });
    expect(courseContentHash(drawn)).not.toBe(courseContentHash(course('A')));
    const moved = course('A', { layout: [{ lat: 28.41, lon: -81.38 }, { lat: 28.425, lon: -81.39 }] });
    expect(courseContentHash(moved)).not.toBe(courseContentHash(drawn));
  });

  it('ignores a degenerate one-point drawing', () => {
    const onePoint = course('A', { layout: [{ lat: 28.41, lon: -81.38 }] });
    expect(courseContentHash(onePoint)).toBe(courseContentHash(course('A')));
  });
});

describe('buildSubmissionPlan', () => {
  const builtin: Track[] = [
    {
      name: 'Orlando Kart Center',
      shortName: 'OKC',
      isUserDefined: false,
      courses: [{ ...course('Normal'), isUserDefined: false }],
    },
  ];

  it('classifies a wholly new user track as new_track', () => {
    const merged: Track[] = [
      ...builtin,
      {
        name: 'My Backyard',
        shortName: 'YARD',
        isUserDefined: true,
        courses: [{ ...course('Loop'), isUserDefined: true }],
      },
    ];
    const plan = buildSubmissionPlan(merged, builtin);
    const group = plan.groups.find((g) => g.trackName === 'My Backyard')!;
    expect(group.trackStatus).toBe('new');
    expect(group.courses[0].type).toBe('new_track');
    expect(group.courses[0].change).toBe('new-track');
    expect(group.courses[0].trackShortName).toBe('YARD');
    expect(plan.pendingCount).toBe(1);
  });

  it('derives a short name for a new track that never got one', () => {
    const merged: Track[] = [
      ...builtin,
      {
        name: 'Sunshine Speed Park',
        // no shortName set (e.g. created before short names were captured)
        isUserDefined: true,
        courses: [{ ...course('Loop'), isUserDefined: true }],
      },
    ];
    const plan = buildSubmissionPlan(merged, builtin);
    const group = plan.groups.find((g) => g.trackName === 'Sunshine Speed Park')!;
    expect(group.shortName).toBe('SSP');
    expect(group.courses[0].trackShortName).toBe('SSP');
  });

  it('classifies a user course added to a built-in track as new_course (track "edited")', () => {
    const merged: Track[] = [
      {
        ...builtin[0],
        courses: [
          { ...course('Normal'), isUserDefined: false },
          { ...course('Reverse'), isUserDefined: true },
        ],
      },
    ];
    const plan = buildSubmissionPlan(merged, builtin);
    const group = plan.groups[0];
    expect(group.trackStatus).toBe('edited');
    expect(group.courses).toHaveLength(1);
    expect(group.courses[0].courseName).toBe('Reverse');
    expect(group.courses[0].type).toBe('new_course');
    expect(group.courses[0].change).toBe('new-course');
  });

  it('classifies an edited built-in course as course_modification', () => {
    const merged: Track[] = [
      {
        ...builtin[0],
        courses: [
          { ...course('Normal', { startFinishA: { lat: 28.5, lon: -81.4 } }), isUserDefined: true },
        ],
      },
    ];
    const plan = buildSubmissionPlan(merged, builtin);
    expect(plan.groups[0].courses[0].type).toBe('course_modification');
    expect(plan.groups[0].courses[0].change).toBe('modified');
  });

  it('skips a user course whose geometry is identical to the built-in course', () => {
    const merged: Track[] = [
      {
        ...builtin[0],
        // marked user-defined but never actually moved
        courses: [{ ...course('Normal'), isUserDefined: true }],
      },
    ];
    const plan = buildSubmissionPlan(merged, builtin);
    expect(plan.groups).toHaveLength(0);
    expect(plan.pendingCount).toBe(0);
  });

  it('re-flags a geometry-identical built-in course once the user adds a drawing, and carries the layout', () => {
    const layout = [{ lat: 28.41, lon: -81.38 }, { lat: 28.42, lon: -81.39 }, { lat: 28.43, lon: -81.40 }];
    const merged: Track[] = [
      {
        ...builtin[0],
        // same geometry as the built-in, but now with a drawn outline
        courses: [{ ...course('Normal'), isUserDefined: true, layout }],
      },
    ];
    const plan = buildSubmissionPlan(merged, builtin);
    expect(plan.groups).toHaveLength(1);
    const sub = plan.groups[0].courses[0];
    expect(sub.type).toBe('course_modification');
    expect(sub.layout).toEqual(layout);
    expect(plan.pendingCount).toBe(1);
  });

  it('does not attach a degenerate one-point layout to a submission', () => {
    const merged: Track[] = [
      ...builtin,
      {
        name: 'My Backyard',
        shortName: 'YARD',
        isUserDefined: true,
        courses: [{ ...course('Loop'), isUserDefined: true, layout: [{ lat: 28.41, lon: -81.38 }] }],
      },
    ];
    const plan = buildSubmissionPlan(merged, builtin);
    expect(plan.groups.find((g) => g.trackName === 'My Backyard')!.courses[0].layout).toBeUndefined();
  });

  it('never includes untouched built-in courses', () => {
    const plan = buildSubmissionPlan(builtin, builtin);
    expect(plan.groups).toHaveLength(0);
  });

  it('marks already-submitted unchanged courses and excludes them from pendingCount', () => {
    const newTrack: Track = {
      name: 'My Backyard', shortName: 'YARD', isUserDefined: true,
      courses: [{ ...course('Loop'), isUserDefined: true }],
    };
    const merged = [...builtin, newTrack];
    const hash = courseContentHash(newTrack.courses[0]);
    const submitted: Record<string, SubmittedRecord> = {
      [submissionKey('My Backyard', 'Loop')]: { hash, submittedAt: 1, batchId: 'b1' },
    };
    const plan = buildSubmissionPlan(merged, builtin, submitted);
    const c = plan.groups[0].courses[0];
    expect(c.alreadySubmitted).toBe(true);
    expect(plan.pendingCount).toBe(0);
    expect(pendingCourses(plan)).toHaveLength(0);
  });

  it('re-flags a previously-submitted course after it is edited', () => {
    const newTrack: Track = {
      name: 'My Backyard', shortName: 'YARD', isUserDefined: true,
      courses: [{ ...course('Loop', { startFinishB: { lat: 29.0, lon: -82.0 } }), isUserDefined: true }],
    };
    const submitted: Record<string, SubmittedRecord> = {
      // stale hash from the pre-edit geometry
      [submissionKey('My Backyard', 'Loop')]: { hash: 'deadbeef', submittedAt: 1, batchId: 'b1' },
    };
    const plan = buildSubmissionPlan([...builtin, newTrack], builtin, submitted);
    expect(plan.groups[0].courses[0].alreadySubmitted).toBe(false);
    expect(plan.pendingCount).toBe(1);
  });
});

describe('mergeSubmittedRecords', () => {
  it('adds new records without dropping existing ones', () => {
    const existing: Record<string, SubmittedRecord> = {
      a: { hash: 'h1', submittedAt: 1, batchId: 'old' },
    };
    const merged = mergeSubmittedRecords(
      existing,
      [{ key: 'b', contentHash: 'h2' }],
      'new-batch',
      123,
    );
    expect(merged.a).toEqual(existing.a);
    expect(merged.b).toEqual({ hash: 'h2', submittedAt: 123, batchId: 'new-batch' });
    // pure — does not mutate the input
    expect(existing.b).toBeUndefined();
  });

  it('overwrites the record for a re-submitted key', () => {
    const merged = mergeSubmittedRecords(
      { a: { hash: 'old', submittedAt: 1, batchId: 'b1' } },
      [{ key: 'a', contentHash: 'fresh' }],
      'b2',
      999,
    );
    expect(merged.a).toEqual({ hash: 'fresh', submittedAt: 999, batchId: 'b2' });
  });
});
