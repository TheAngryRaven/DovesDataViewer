// How (and whether) to nudge this browser toward an installed, offline-capable
// copy of the app.
//
// WHY THIS EXISTS — iOS. Safari supports service workers, so the app *does*
// cache and run offline in a plain tab. What it does not do is keep that cache:
// WebKit's storage policy deletes all script-writable storage (the service
// worker registration, the Cache API precache, and our IndexedDB sessions) for
// a site the user hasn't interacted with in ~7 days of browser use. Show up at
// a track a week after the last visit and there is nothing left to run offline.
//
// Adding the app to the Home Screen moves it out of that bucket: a Home Screen
// web app gets a far larger quota and its own idle counter that only advances
// on days the app is actually opened, so a season-long gap between race
// weekends doesn't wipe it.
//
// The catch is that iOS never fires `beforeinstallprompt` — the event the rest
// of the world uses to offer installation — so the only way to tell an iPhone
// user any of this is to detect the situation ourselves and render the
// share-sheet instructions by hand.

/** What, if anything, to offer this browser. */
export type InstallState =
  /** Already running as an installed app — nothing to offer. */
  | "installed"
  /** iOS/iPadOS in a browser tab: no install event, so we hand-hold instead. */
  | "ios-manual"
  /** Everyone else: wait for `beforeinstallprompt` and use the real prompt. */
  | "prompt-capable";

export interface InstallEnvironment {
  userAgent: string;
  /** `navigator.platform` — iPadOS 13+ reports "MacIntel", see below. */
  platform?: string;
  /** `navigator.maxTouchPoints` — the tell that a "Mac" is really an iPad. */
  maxTouchPoints?: number;
  /** `matchMedia("(display-mode: standalone)").matches`. */
  displayModeStandalone?: boolean;
  /** Legacy `navigator.standalone` — the only signal iOS Safari gives. */
  navigatorStandalone?: boolean;
}

/**
 * True for iPhone/iPod/iPad, including the iPad's desktop-class user agent.
 * Since iPadOS 13 an iPad reports itself as "Macintosh…MacIntel" with no iOS
 * token at all; the touch-point count is what separates it from a real Mac
 * (desktop Safari reports 0).
 */
export function isIosDevice(env: InstallEnvironment): boolean {
  if (/iPad|iPhone|iPod/.test(env.userAgent)) return true;
  const looksLikeMac =
    env.platform === "MacIntel" || /Macintosh/.test(env.userAgent);
  return looksLikeMac && (env.maxTouchPoints ?? 0) > 1;
}

/** True when the page is running as an installed app rather than in a tab. */
export function isInstalledApp(env: InstallEnvironment): boolean {
  return env.displayModeStandalone === true || env.navigatorStandalone === true;
}

/** Which install affordance this browser needs. */
export function detectInstallState(env: InstallEnvironment): InstallState {
  if (isInstalledApp(env)) return "installed";
  return isIosDevice(env) ? "ios-manual" : "prompt-capable";
}

/** Read the live browser environment. Returns a UA-less env when there is no DOM. */
export function readInstallEnvironment(): InstallEnvironment {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return { userAgent: "" };
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    displayModeStandalone: window.matchMedia?.("(display-mode: standalone)")
      .matches,
    navigatorStandalone: nav.standalone,
  };
}

/**
 * How long a dismissal sticks. The iOS hint is the difference between having
 * the app at the track and not, so "not now" snoozes rather than silences —
 * but a month is long enough not to nag.
 */
export const INSTALL_HINT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/** localStorage key holding the epoch-ms of the last dismissal. */
export const INSTALL_HINT_SNOOZE_KEY = "pwa-install-snoozed-at";

/**
 * Whether a snooze recorded at `snoozedAt` (the raw stored string, so callers
 * can pass `localStorage.getItem` straight through) still suppresses the hint.
 * Unparseable or future-dated values are treated as "not snoozed" — a corrupt
 * value should not hide the hint forever.
 */
export function isSnoozed(snoozedAt: string | null, now: number): boolean {
  if (!snoozedAt) return false;
  const at = Number(snoozedAt);
  if (!Number.isFinite(at) || at > now) return false;
  return now - at < INSTALL_HINT_SNOOZE_MS;
}
