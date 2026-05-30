// Pure logic for the hierarchical file browser: Track → Course → logs, with an
// optional Engine/Kart filter on the final list, breadcrumbs, and smart folder
// collapsing ("clicking sucks" — only build a folder level when there's more
// than one thing in it). No React / no IndexedDB so the tree + navigation math
// stays unit-testable; the UI (FilesTab) just renders the computed view.

import type { FileEntry, FileMetadata } from "./fileStorage";
import type { Vehicle } from "./vehicleStorage";

export type FilterMode = "none" | "engine" | "kart";

/** Sentinel track key for the bucket of sessions with no track/course tag. */
export const UNTAGGED_TRACK = "__UNTAGGED__";

/** One log, flattened with everything the browser needs to group + label it. */
export interface BrowserSession {
  fileName: string;
  /** Date/time label derived from the session's first valid sample. */
  displayName: string;
  savedAt: number;
  startTime?: number;
  trackName?: string;
  courseName?: string;
  /** Resolved engine string (frozen `sessionEngine`, else the live vehicle's). */
  engine?: string;
  kartId?: string;
  kartName?: string;
  fastestLapMs?: number;
}

/** Where the browser is currently pointing. */
export interface NavState {
  /** Track name, or UNTAGGED_TRACK, or undefined for the root. */
  track?: string;
  course?: string;
  filter: FilterMode;
  /** Selected engine string / kart id when drilled into a filter folder. */
  filterValue?: string;
}

export const ROOT_NAV: NavState = { filter: "none" };

export interface BrowserFolder {
  kind: "track" | "course" | "engine" | "kart";
  /** Raw grouping value (track/course name, engine string, or kart id). */
  key: string;
  label: string;
  count: number;
  /** Nav to apply when this folder is opened. */
  nav: NavState;
}

export interface BreadcrumbSegment {
  label: string;
  /** Nav to apply when this crumb is clicked. */
  nav: NavState;
}

export interface BrowserView {
  breadcrumb: BreadcrumbSegment[];
  /** Folders to render at the current level (may be empty). */
  folders: BrowserFolder[];
  /** Loose logs to render below the folders (the final list, or "unconfigured"). */
  sessions: BrowserSession[];
  /** Current filter — only meaningful (and `showFilter` true) at the log level. */
  filterMode: FilterMode;
  showFilter: boolean;
}

// ── Display name ─────────────────────────────────────────────────────────────

/**
 * The browser label for a session: the date + time of its first valid sample
 * (e.g. "2/12/2026 11:15 AM"), independent of upload time. Falls back to the raw
 * file name when no start time is known (older logs, before backfill).
 */
export function formatSessionDisplayName(
  startTime: number | undefined,
  fileName: string,
): string {
  if (startTime == null || !Number.isFinite(startTime)) return fileName;
  const d = new Date(startTime);
  const date = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  let h = d.getHours();
  const ampm = h < 12 ? "AM" : "PM";
  h = h % 12;
  if (h === 0) h = 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${date} ${h}:${mm} ${ampm}`;
}

// ── Building the session list ────────────────────────────────────────────────

/** Flatten stored files + their metadata + the vehicle list into BrowserSessions. */
export function buildBrowserSessions(
  files: FileEntry[],
  metaMap: Map<string, FileMetadata>,
  vehicles: Vehicle[],
): BrowserSession[] {
  const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
  return files.map((f) => {
    const meta = metaMap.get(f.name);
    const vehicle = meta?.sessionKartId ? vehiclesById.get(meta.sessionKartId) : undefined;
    // Prefer the frozen engine snapshot; fall back to the live vehicle's engine.
    const engineRaw = meta?.sessionEngine ?? vehicle?.engine;
    const engine = engineRaw?.trim() || undefined;
    return {
      fileName: f.name,
      displayName: formatSessionDisplayName(meta?.sessionStartTime, f.name),
      savedAt: f.savedAt,
      startTime: meta?.sessionStartTime,
      trackName: meta?.trackName?.trim() || undefined,
      courseName: meta?.courseName?.trim() || undefined,
      engine,
      kartId: meta?.sessionKartId || undefined,
      kartName: vehicle?.name,
      fastestLapMs: meta?.fastestLapMs,
    };
  });
}

// ── Navigation / view computation ────────────────────────────────────────────

/** Newest first (by session start, falling back to save time). */
function sortLogs(sessions: BrowserSession[]): BrowserSession[] {
  return [...sessions].sort((a, b) => (b.startTime ?? b.savedAt) - (a.startTime ?? a.savedAt));
}

/** A session belongs in the tree only when it has both a track and a course. */
function isTagged(s: BrowserSession): boolean {
  return !!s.trackName && !!s.courseName;
}

function distinctSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

interface TopGroup {
  key: string;
  label: string;
  sessions: BrowserSession[];
}

/** Top-level groups: one per track (alpha), then an "Untagged" bucket if needed. */
function topLevelGroups(sessions: BrowserSession[]): TopGroup[] {
  const tagged = sessions.filter(isTagged);
  const untagged = sessions.filter((s) => !isTagged(s));
  const groups: TopGroup[] = distinctSorted(tagged.map((s) => s.trackName!)).map((track) => ({
    key: track,
    label: track,
    sessions: tagged.filter((s) => s.trackName === track),
  }));
  if (untagged.length > 0) {
    groups.push({ key: UNTAGGED_TRACK, label: "Untagged", sessions: untagged });
  }
  return groups;
}

/** Build the log-level view (final list or engine/kart filter folders). */
function logsView(
  set: BrowserSession[],
  nav: NavState,
  breadcrumb: BreadcrumbSegment[],
): BrowserView {
  const filterMode = nav.filter;
  if (filterMode === "none") {
    return { breadcrumb, folders: [], sessions: sortLogs(set), filterMode, showFilter: true };
  }

  const keyOf = (s: BrowserSession) => (filterMode === "engine" ? s.engine : s.kartId);
  const labelOf = (s: BrowserSession) =>
    filterMode === "engine" ? s.engine! : s.kartName || s.kartId!;

  // Drilled into one specific engine/kart folder → show just its logs.
  if (nav.filterValue != null) {
    const inside = set.filter((s) => keyOf(s) === nav.filterValue);
    const label = inside[0] ? labelOf(inside[0]) : nav.filterValue;
    return {
      breadcrumb: [...breadcrumb, { label, nav }],
      folders: [],
      sessions: sortLogs(inside),
      filterMode,
      showFilter: true,
    };
  }

  // Group configured logs into folders (always shown, even a single group), with
  // unconfigured logs (no engine/kart) listed loosely below.
  const configured = set.filter((s) => keyOf(s));
  const unconfigured = set.filter((s) => !keyOf(s));
  const keys = distinctSorted(configured.map((s) => keyOf(s)!));
  const folders: BrowserFolder[] = keys.map((key) => {
    const group = configured.filter((s) => keyOf(s) === key);
    return {
      kind: filterMode,
      key,
      label: labelOf(group[0]),
      count: group.length,
      nav: { ...nav, filterValue: key },
    };
  });
  return { breadcrumb, folders, sessions: sortLogs(unconfigured), filterMode, showFilter: true };
}

/**
 * Resolve the current navigation into a renderable view. Levels with a single
 * entry auto-collapse (we descend through them, still recording the breadcrumb),
 * so the user only sees folders where there's a real choice to make. Stale nav
 * (a track/course that no longer exists) gracefully falls back toward the root.
 */
export function computeBrowserView(sessions: BrowserSession[], nav: NavState): BrowserView {
  const groups = topLevelGroups(sessions);
  const breadcrumb: BreadcrumbSegment[] = [{ label: "All sessions", nav: ROOT_NAV }];

  // ── Track level ──
  let effTrack = nav.track;
  let group = effTrack ? groups.find((g) => g.key === effTrack) : undefined;
  if (effTrack && !group) effTrack = undefined; // stale → behave as root

  if (!effTrack) {
    if (groups.length === 0) {
      return { breadcrumb, folders: [], sessions: [], filterMode: "none", showFilter: false };
    }
    if (groups.length > 1) {
      const folders: BrowserFolder[] = groups.map((g) => ({
        kind: "track",
        key: g.key,
        label: g.label,
        count: g.sessions.length,
        nav: { track: g.key, filter: "none" },
      }));
      return { breadcrumb, folders, sessions: [], filterMode: "none", showFilter: false };
    }
    effTrack = groups[0].key; // single track → collapse into it
    group = groups[0];
  }
  group = group ?? groups.find((g) => g.key === effTrack)!;
  breadcrumb.push({ label: group.label, nav: { track: effTrack, filter: "none" } });

  // Untagged bucket has no course level → straight to logs.
  if (effTrack === UNTAGGED_TRACK) {
    return logsView(group.sessions, nav, breadcrumb);
  }

  // ── Course level ──
  const courses = distinctSorted(group.sessions.map((s) => s.courseName!));
  let effCourse = nav.course;
  if (effCourse && !courses.includes(effCourse)) effCourse = undefined; // stale

  if (!effCourse) {
    if (courses.length > 1) {
      const folders: BrowserFolder[] = courses.map((c) => ({
        kind: "course",
        key: c,
        label: c,
        count: group!.sessions.filter((s) => s.courseName === c).length,
        nav: { track: effTrack, course: c, filter: "none" },
      }));
      return { breadcrumb, folders, sessions: [], filterMode: "none", showFilter: false };
    }
    if (courses.length === 0) return logsView(group.sessions, nav, breadcrumb);
    effCourse = courses[0]; // single course → collapse into it
  }
  // Clicking this crumb returns to the course's folder grid, keeping the filter.
  breadcrumb.push({
    label: effCourse,
    nav: { track: effTrack, course: effCourse, filter: nav.filter },
  });
  const courseSessions = group.sessions.filter((s) => s.courseName === effCourse);
  return logsView(courseSessions, nav, breadcrumb);
}

/** Seed nav from the currently-loaded session's track/course (compute collapses). */
export function defaultNav(currentTrack?: string | null, currentCourse?: string | null): NavState {
  if (!currentTrack) return ROOT_NAV;
  return { track: currentTrack, course: currentCourse ?? undefined, filter: "none" };
}
