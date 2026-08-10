/**
 * The sync wizard's state, as data.
 *
 * Two screens — name the tracks, then name their courses — plus the selection
 * and validation that decide whether "Save & import" can fire. All of it lives
 * here rather than in the dialog because the test environment is `node`: a
 * component cannot be rendered, so logic left in the `.tsx` is logic nobody
 * checks.
 */

import type { TrackKind } from '@/lib/ble/trackOpcodes';
import type { SyncPlan, SyncCourseRow, SyncTrackRow } from '@/lib/deviceSyncPlan';
import type { SyncResolution } from '@/lib/deviceSyncOps';
import {
  editCourseName,
  editTrackName,
  editTrackShortName,
  initialCourseDraft,
  initialTrackDraft,
  validateCourseDraft,
  validateTrackDraft,
  type CourseNameDraft,
  type NameProblem,
  type TrackNameDraft,
} from '@/lib/deviceSyncNames';

/** Which screen the wizard is on. */
export type WizardStep = 'tracks' | 'courses';

/** A short name already spoken for by a track this wizard isn't touching. */
export interface ReservedShortName {
  kind: TrackKind;
  shortName: string;
}

export interface WizardState {
  step: WizardStep;
  plan: SyncPlan;
  /** Track row keys the user wants to sync. Everything starts checked. */
  selected: ReadonlySet<string>;
  trackDrafts: Readonly<Record<string, TrackNameDraft>>;
  courseDrafts: Readonly<Record<string, CourseNameDraft>>;
  /**
   * Short names held by tracks outside this plan — already-synced ones. Renaming
   * a walked track onto one of those would overwrite a real track's file.
   */
  reserved: readonly ReservedShortName[];
}

export function initWizard(
  plan: SyncPlan,
  reserved: readonly ReservedShortName[] = [],
): WizardState {
  const trackDrafts: Record<string, TrackNameDraft> = {};
  const courseDrafts: Record<string, CourseNameDraft> = {};

  for (const row of plan.rows) {
    const draft = initialTrackDraft(row);
    trackDrafts[row.key] = draft;
    for (const course of row.courses) {
      courseDrafts[course.key] = initialCourseDraft(course);
    }
  }

  return {
    step: 'tracks',
    plan,
    // Everything the plan offers is checked: it only contains real differences,
    // and the rows that could never converge were dropped before this point.
    selected: new Set(plan.rows.map((r) => r.key)),
    trackDrafts,
    courseDrafts,
    reserved,
  };
}

// ─── Selection ───────────────────────────────────────────────────────────────

export function toggleRow(state: WizardState, key: string): WizardState {
  const selected = new Set(state.selected);
  if (selected.has(key)) selected.delete(key);
  else selected.add(key);
  return { ...state, selected };
}

/** Rows the user is actually syncing. Everything downstream works off this. */
export function selectedRows(state: WizardState): SyncTrackRow[] {
  return state.plan.rows.filter((r) => state.selected.has(r.key));
}

/** Course rows of the selected tracks, in track order. */
export function selectedCourseRows(state: WizardState): SyncCourseRow[] {
  return selectedRows(state).flatMap((r) => r.courses);
}

// ─── Editing ─────────────────────────────────────────────────────────────────

export function setTrackName(state: WizardState, key: string, name: string): WizardState {
  const draft = state.trackDrafts[key];
  if (!draft) return state;
  return { ...state, trackDrafts: { ...state.trackDrafts, [key]: editTrackName(draft, name) } };
}

export function setTrackShortName(
  state: WizardState,
  key: string,
  shortName: string,
): WizardState {
  const draft = state.trackDrafts[key];
  if (!draft) return state;
  return {
    ...state,
    trackDrafts: { ...state.trackDrafts, [key]: editTrackShortName(draft, shortName) },
  };
}

export function setCourseName(
  state: WizardState,
  courseKey: string,
  name: string,
): WizardState {
  const draft = state.courseDrafts[courseKey];
  if (!draft) return state;
  return {
    ...state,
    courseDrafts: { ...state.courseDrafts, [courseKey]: editCourseName(draft, name) },
  };
}

// ─── Navigation ──────────────────────────────────────────────────────────────

/**
 * Move to the course screen.
 *
 * Course names are independent of the track name — renaming the track and
 * coming forward again does not touch them, because a course is not its track.
 */
export function goToCourses(state: WizardState): WizardState {
  return { ...state, step: 'courses' };
}

export function goToTracks(state: WizardState): WizardState {
  return { ...state, step: 'tracks' };
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Naming problems on the track screen, by row key. Only selected rows are
 * checked — unchecking a row you don't want to name is a legitimate way past it.
 */
export function trackProblems(state: WizardState): Record<string, NameProblem> {
  const problems: Record<string, NameProblem> = {};
  const rows = selectedRows(state);

  for (const row of rows) {
    const draft = state.trackDrafts[row.key];
    if (!draft) continue;
    // Everything else of the same kind that will exist on the device afterwards.
    const taken = [
      ...state.reserved.filter((r) => r.kind === row.kind).map((r) => r.shortName),
      ...rows
        .filter((other) => other.key !== row.key && other.kind === row.kind)
        .map((other) => state.trackDrafts[other.key]?.shortName ?? other.shortName),
    ].filter(Boolean);

    const problem = validateTrackDraft(draft, { takenShortNames: taken });
    if (problem) problems[row.key] = problem;
  }

  return problems;
}

/** Naming problems on the course screen, by course row key. */
export function courseProblems(state: WizardState): Record<string, NameProblem> {
  const problems: Record<string, NameProblem> = {};
  for (const course of selectedCourseRows(state)) {
    const draft = state.courseDrafts[course.key];
    if (!draft) continue;
    const problem = validateCourseDraft(draft, course.kind);
    if (problem) problems[course.key] = problem;
  }
  return problems;
}

/** Whether Next is live: at least one row, and every selected one named. */
export function canAdvance(state: WizardState): boolean {
  if (state.selected.size === 0) return false;
  return Object.keys(trackProblems(state)).length === 0;
}

/** Whether Save & import is live. Re-checks the track screen too. */
export function canSave(state: WizardState): boolean {
  return canAdvance(state) && Object.keys(courseProblems(state)).length === 0;
}

// ─── Handing off ─────────────────────────────────────────────────────────────

/** The selected rows plus their final names, ready for `planOperations`. */
export function resolutions(state: WizardState): SyncResolution[] {
  return selectedRows(state).map((row) => {
    const draft = state.trackDrafts[row.key];
    const courseNames: Record<string, string> = {};
    for (const course of row.courses) {
      const courseDraft = state.courseDrafts[course.key];
      if (courseDraft) courseNames[course.key] = courseDraft.name.trim();
    }
    return {
      row,
      name: draft?.name.trim() ?? row.name,
      shortName: draft?.shortName.trim() ?? row.shortName,
      courseNames,
    };
  });
}
