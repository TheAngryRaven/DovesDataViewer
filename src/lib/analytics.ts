// Anonymous usage statistics (plan 0030) — PostHog, web-only, opt-out, cookieless.
//
// The goal is the basics: how many people visit and roughly how long they stay.
// Nothing finer. So autocapture (every click and form), session replay, surveys,
// heatmaps and exception capture are all OFF; the only events are `$pageview` /
// `$pageleave`, which PostHog's Web Analytics dashboard turns into visitors,
// session duration, bounce rate, referrers and countries.
//
// Privacy contract (mirrored in pages/Privacy.tsx — keep the two in sync):
//   - Cookieless: nothing is written to cookies, localStorage or sessionStorage.
//     PostHog derives a visitor hash server-side from a salt it rotates daily,
//     so visits cannot be linked across days or to an account, name or email.
//   - Every URL-shaped property is scrubbed before it leaves the browser (see
//     `scrubEvent`): no query string, no fragment (Supabase puts auth tokens
//     there), share tokens and usernames replaced by placeholders, other sites'
//     referrers cut to their origin. No document title is sent.
//   - No telemetry, file names, GPS or garage data is ever sent.
//   - The user can switch it off in Settings ("Send anonymous usage stats");
//     Do Not Track / Global Privacy Control stop it before PostHog is even
//     downloaded.
//   - Native (Android), embedded (iframe) and `?nosw=1` preview contexts never
//     start it.
//
// OPERATOR CHECKLIST — do this in the PostHog project BEFORE setting
// VITE_POSTHOG_KEY (README "Anonymous usage statistics" repeats it):
//   1. Enable "Cookieless server hash mode" — without it PostHog drops every
//      cookieless event, so forgetting it fails closed.
//   2. Enable "Discard client IP data" — the IP is then used only for the coarse
//      geo lookup and not stored, which is what the privacy policy says.
//
// This module stays on the eager graph (main.tsx + useSettings), so it must be
// tiny: `posthog-js` is dynamic-imported only when analytics actually starts,
// and in a keyless build that import is statically dead and dropped entirely.

import type { CaptureResult, PostHog } from "posthog-js";
import { buildInfo, isPreviewBuild, type BuildInfo } from "@/lib/buildInfo";
import { isNativeApp } from "@/lib/platform";

/** PostHog's US cloud ingest host — the default when VITE_POSTHOG_HOST is unset. */
export const DEFAULT_ANALYTICS_HOST = "https://us.i.posthog.com";

/** Mirrors SETTINGS_KEY in hooks/useSettings — kept literal so this module stays hook-free. */
const SETTINGS_KEY = "dove-dataviewer-settings";

/** Storage keys and cookies PostHog uses when it is NOT cookieless (earlier builds of this feature). */
const POSTHOG_STORAGE_PREFIX = "ph_";

export interface AnalyticsEnv {
  VITE_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
}

export interface AnalyticsConfig {
  key: string;
  host: string;
}

/**
 * The PostHog project this build reports to, or null when no key was baked in
 * (self-hosters, local dev, native builds) — null means analytics is simply
 * absent, not opted out.
 */
export function analyticsConfig(env: AnalyticsEnv = import.meta.env): AnalyticsConfig | null {
  const key = env.VITE_POSTHOG_KEY?.trim();
  if (!key) return null;
  const host = env.VITE_POSTHOG_HOST?.trim().replace(/\/+$/, "");
  return { key, host: host || DEFAULT_ANALYTICS_HOST };
}

export interface AnalyticsGate {
  /** A project key was baked into this build. */
  configured: boolean;
  /** Running inside the Tauri/Android shell. */
  native: boolean;
  /** Running inside an iframe (embedded previews). */
  embedded: boolean;
  /** Loaded on a `?nosw=1` preview/test host. */
  previewHost: boolean;
  /** The browser sends Do Not Track or Global Privacy Control. */
  browserOptOut: boolean;
  /** The user's "Send anonymous usage stats" setting. */
  optedIn: boolean;
}

/** Every condition must hold; all but `optedIn` are fixed for the page's lifetime. */
export function shouldStartAnalytics(gate: AnalyticsGate): boolean {
  return (
    gate.configured &&
    !gate.native &&
    !gate.embedded &&
    !gate.previewHost &&
    !gate.browserOptOut &&
    gate.optedIn
  );
}

/**
 * Reads the usage-stats preference out of the raw persisted settings blob.
 * Missing, malformed or non-boolean → true (the setting defaults on).
 */
export function parseUsageStatsPreference(raw: string | null | undefined): boolean {
  if (!raw) return true;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "sendUsageStats" in parsed) {
      const value = (parsed as { sendUsageStats: unknown }).sendUsageStats;
      if (typeof value === "boolean") return value;
    }
  } catch {
    /* malformed settings — fall through to the default */
  }
  return true;
}

function readUsageStatsPreference(): boolean {
  try {
    return parseUsageStatsPreference(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return true;
  }
}

/** The DNT / GPC values a browser can expose, any of which means "don't track me". */
export interface PrivacySignals {
  doNotTrack?: string | null;
  msDoNotTrack?: string | null;
  windowDoNotTrack?: string | null;
  globalPrivacyControl?: boolean | null;
}

/** True when the browser asks not to be tracked — checked before PostHog is ever loaded. */
export function hasBrowserOptOut(signals: PrivacySignals): boolean {
  const on = (v: string | null | undefined) => v === "1" || v === "yes";
  return (
    on(signals.doNotTrack) ||
    on(signals.msDoNotTrack) ||
    on(signals.windowDoNotTrack) ||
    signals.globalPrivacyControl === true
  );
}

function readPrivacySignals(): PrivacySignals {
  try {
    const nav = navigator as Navigator & { msDoNotTrack?: string; globalPrivacyControl?: boolean };
    const win = window as Window & { doNotTrack?: string };
    return {
      doNotTrack: nav.doNotTrack,
      msDoNotTrack: nav.msDoNotTrack,
      windowDoNotTrack: win.doNotTrack,
      globalPrivacyControl: nav.globalPrivacyControl,
    };
  } catch {
    // Can't read the signals → assume the user may have set one.
    return { globalPrivacyControl: true };
  }
}

/**
 * Super-properties stamped on every event so one PostHog project can be split
 * by channel (production vs beta/preview deploys) and by install type.
 */
export function buildContextProperties(
  info: BuildInfo = buildInfo,
  standalone: boolean = isStandaloneDisplay(),
): Record<string, string> {
  return {
    app_version: info.version,
    app_channel: isPreviewBuild(info) ? "preview" : "production",
    app_display_mode: standalone ? "standalone" : "browser",
  };
}

// ---------------------------------------------------------------------------
// Event scrubbing — the last thing that runs before an event leaves the page.
// ---------------------------------------------------------------------------

/**
 * Path segments that are secrets or personal data. `/s/:token` IS the access
 * key to a shared session; `/driver/:username` names a person.
 */
const SENSITIVE_PATHS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/s\/[^/]+/, "/s/:token"],
  [/^\/driver\/[^/]+/, "/driver/:username"],
];

/** Property names whose value is a URL or path PostHog collected from the page. */
const URL_PROPERTY = /(url|href|referrer|pathname|referring_domain)$/i;

/** Properties dropped outright: titles can name a driver or a session. */
const DROPPED_PROPERTIES = ["title", "$title", "$initial_title"] as const;

/** Rewrites a sensitive path to its placeholder; other paths pass through. */
export function scrubPath(pathname: string): string {
  for (const [pattern, placeholder] of SENSITIVE_PATHS) {
    if (pattern.test(pathname)) return pathname.replace(pattern, placeholder);
  }
  return pathname;
}

/**
 * Reduces one URL-ish value to what analytics needs. Same-origin URLs keep
 * origin + scrubbed path; other sites' URLs (referrers) keep their origin only;
 * a bare path is scrubbed; query strings and fragments never survive.
 * Anything unparseable is dropped rather than risk sending it.
 */
export function scrubUrl(value: string, ownOrigin: string): string | null {
  if (value === "" || value === "$direct") return value;
  if (value.startsWith("/")) {
    const path = value.split(/[?#]/, 1)[0];
    return scrubPath(path);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // A bare hostname (e.g. $referring_domain) has no secrets to strip.
    return /^[a-z0-9.-]+(:\d+)?$/i.test(value) ? value : null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== ownOrigin) return url.origin;
  return url.origin + scrubPath(url.pathname);
}

function scrubProperties(props: Record<string, unknown> | undefined, ownOrigin: string): void {
  if (!props) return;
  for (const name of DROPPED_PROPERTIES) delete props[name];
  for (const [name, value] of Object.entries(props)) {
    if (typeof value !== "string" || !URL_PROPERTY.test(name)) continue;
    const scrubbed = scrubUrl(value, ownOrigin);
    if (scrubbed === null) delete props[name];
    else props[name] = scrubbed;
  }
}

/**
 * `before_send` hook: scrubs every URL-shaped property on the event and on its
 * `$set` / `$set_once` payloads. Exported for tests.
 */
export function scrubEvent(event: CaptureResult | null, ownOrigin: string): CaptureResult | null {
  if (!event) return event;
  scrubProperties(event.properties, ownOrigin);
  scrubProperties(event.$set, ownOrigin);
  scrubProperties(event.$set_once, ownOrigin);
  return event;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/** True when launched as an installed PWA rather than a browser tab. */
function isStandaloneDisplay(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isPreviewHost(): boolean {
  try {
    return window.location.search.includes("nosw=1");
  } catch {
    return false;
  }
}

/** Every gate except the user's own setting, read from the live page. */
function environmentGate(optedIn: boolean): AnalyticsGate {
  return {
    configured: analyticsConfig() !== null,
    native: isNativeApp(),
    embedded: isEmbedded(),
    previewHost: isPreviewHost(),
    browserOptOut: hasBrowserOptOut(readPrivacySignals()),
    optedIn,
  };
}

/**
 * True when this build and page can report at all — the Settings toggle and the
 * privacy-policy section only show then. A DNT/GPC browser can't report either,
 * but still sees the toggle and policy: the build does collect from others.
 */
export function isAnalyticsAvailable(): boolean {
  const gate = environmentGate(true);
  return gate.configured && !gate.native && !gate.embedded && !gate.previewHost;
}

/**
 * Removes identifiers an earlier, non-cookieless build may have left behind
 * (`ph_*` localStorage keys and cookies). Safe to call anywhere, any time.
 */
export function clearStoredIdentifiers(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(POSTHOG_STORAGE_PREFIX)) stale.push(key);
    }
    stale.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* storage unavailable — nothing to clear */
  }
  try {
    const host = window.location.hostname;
    // PostHog set its cookie on the registrable domain so prod and beta shared it.
    const parent = host.split(".").slice(-2).join(".");
    for (const part of document.cookie.split(";")) {
      const name = part.split("=", 1)[0].trim();
      if (!name.startsWith(POSTHOG_STORAGE_PREFIX)) continue;
      for (const domain of ["", `; domain=${host}`, `; domain=.${parent}`]) {
        document.cookie = `${name}=; Max-Age=0; path=/${domain}`;
      }
    }
  } catch {
    /* no cookie access (sandboxed) — nothing to clear */
  }
}

/** localStorage flag: the one-time "we now count anonymous visits" notice was shown. */
const NOTICE_KEY = "lapwing-usage-stats-notice-seen";

/**
 * True exactly once per browser: the first time analytics starts, so people who
 * had the app before the setting existed are told about it rather than opted in
 * silently. Marks itself seen. Storage failures answer false (no nagging).
 */
export function takeUsageStatsNotice(storage: Pick<Storage, "getItem" | "setItem"> = localStorage): boolean {
  try {
    if (storage.getItem(NOTICE_KEY)) return false;
    storage.setItem(NOTICE_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** Set by initAnalytics; setUsageStatsEnabled never starts PostHog on its own before boot ran. */
let booted = false;
let client: Promise<PostHog | null> | null = null;

async function loadClient(config: AnalyticsConfig): Promise<PostHog | null> {
  // A literal check of the define()'d build constant: in a keyless build this is
  // `if (!"") return null`, so Rollup drops the import below and no PostHog
  // chunk is emitted at all.
  if (!import.meta.env.VITE_POSTHOG_KEY) return null;
  try {
    const { default: posthog } = await import("posthog-js");
    const ownOrigin = window.location.origin;
    posthog.init(config.key, {
      api_host: config.host,
      // No cookies, no localStorage, no sessionStorage — PostHog hashes the
      // visitor server-side with a daily-rotating salt.
      cookieless_mode: "always",
      // Pageviews on the initial load and on every React Router navigation;
      // pageleave is what gives session duration.
      capture_pageview: "history_change",
      capture_pageleave: true,
      // Coarse stats only — see the header comment.
      autocapture: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_web_experiments: true,
      // Never pull extra scripts from PostHog's CDN at runtime.
      disable_external_dependency_loading: true,
      // No feature flags in use; skipping the /flags call saves a request.
      advanced_disable_flags: true,
      // Anonymous visitors stay anonymous events — no person profiles.
      person_profiles: "identified_only",
      // Belt and braces: we gate on DNT/GPC before loading, and so does PostHog.
      respect_dnt: true,
      // Strip ad-click ids (gclid, fbclid…) even before our own scrub runs.
      mask_personal_data_properties: true,
      before_send: (event) => scrubEvent(event, ownOrigin),
    });
    posthog.register(buildContextProperties());
    return posthog;
  } catch {
    // Blocked by an ad blocker or offline — analytics is best-effort and must
    // never surface as an app error.
    return null;
  }
}

function ensureClient(config: AnalyticsConfig): Promise<PostHog | null> {
  client ??= loadClient(config);
  return client;
}

/**
 * Boot-time entry point (main.tsx), and the ONLY place analytics is first
 * started. Loads PostHog only when every gate passes; when any fails, nothing
 * is downloaded at all. Returns whether it started.
 */
export async function initAnalytics(): Promise<boolean> {
  booted = true;
  clearStoredIdentifiers();
  const config = analyticsConfig();
  if (!config) return false;
  if (!shouldStartAnalytics(environmentGate(readUsageStatsPreference()))) return false;
  const posthog = await ensureClient(config);
  // The Settings toggle is our source of truth: undo an in-session opt-out.
  if (posthog?.has_opted_out_capturing()) {
    posthog.opt_in_capturing({ captureEventName: false });
  }
  return posthog !== null;
}

/**
 * Settings-toggle entry point (useSettings), called only when the user flips the
 * switch. Opting out stops capture at once and clears any stored identifier;
 * opting back in starts the client, but only on a page where boot would have.
 */
export function setUsageStatsEnabled(enabled: boolean): void {
  if (!enabled) {
    clearStoredIdentifiers();
    // Nothing loaded yet means nothing to stop — and we must not load it now.
    if (client) void client.then((posthog) => posthog?.opt_out_capturing());
    return;
  }
  const config = analyticsConfig();
  if (!booted || !config || !shouldStartAnalytics(environmentGate(true))) return;
  void ensureClient(config).then((posthog) => {
    if (posthog?.has_opted_out_capturing()) {
      posthog.opt_in_capturing({ captureEventName: false });
    }
  });
}

