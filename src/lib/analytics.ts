// Anonymous usage statistics (plan 0029) — PostHog, web-only, opt-out.
//
// The goal is the GA-style basics: how many people visit, how many come back,
// and roughly how long they stay. Nothing finer. So autocapture (every click
// and form), session replay, surveys, heatmaps and exception capture are all
// OFF; the only events are `$pageview` / `$pageleave`, which PostHog's Web
// Analytics dashboard turns into visitors, returning visitors, session
// duration, bounce rate, referrers and countries.
//
// Privacy contract (mirrored in pages/Privacy.tsx — keep the two in sync):
//   - A random anonymous id lives in this browser so a return visit counts as
//     returning. It is never linked to an account, a name or an email.
//   - No telemetry, file names, GPS or garage data is ever sent.
//   - The user can switch it off in Settings ("Send anonymous usage stats");
//     Do Not Track / Global Privacy Control are honoured too (`respect_dnt`).
//   - Native (Android) and embedded (iframe) contexts never start it.
//
// OPERATOR NOTE: in the PostHog project, enable "Discard client IP data" so the
// IP is used only for the coarse geo lookup and not stored on events — the
// privacy policy describes it that way.
//
// This module stays on the eager graph (main.tsx + useSettings), so it must be
// tiny: `posthog-js` is dynamic-imported only when analytics actually starts.

import type { PostHog } from "posthog-js";
import { buildInfo, isPreviewBuild, type BuildInfo } from "@/lib/buildInfo";
import { isNativeApp } from "@/lib/platform";

/** PostHog's US cloud ingest host — the default when VITE_POSTHOG_HOST is unset. */
export const DEFAULT_ANALYTICS_HOST = "https://us.i.posthog.com";

/** Mirrors SETTINGS_KEY in hooks/useSettings — kept literal so this module stays hook-free. */
const SETTINGS_KEY = "dove-dataviewer-settings";

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
  /** The user's "Send anonymous usage stats" setting. */
  optedIn: boolean;
}

/** Every condition must hold; the first three never change for the page's lifetime. */
export function shouldStartAnalytics(gate: AnalyticsGate): boolean {
  return gate.configured && !gate.native && !gate.embedded && gate.optedIn;
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

/** True when this build can report at all — the Settings toggle only shows then. */
export function isAnalyticsAvailable(): boolean {
  return analyticsConfig() !== null && !isNativeApp() && !isEmbedded();
}

let client: Promise<PostHog | null> | null = null;

async function loadClient(config: AnalyticsConfig): Promise<PostHog | null> {
  try {
    const { default: posthog } = await import("posthog-js");
    posthog.init(config.key, {
      api_host: config.host,
      // Pageviews on the initial load and on every React Router navigation;
      // pageleave is what gives session duration.
      capture_pageview: "history_change",
      capture_pageleave: true,
      // Coarse stats only — see the header comment.
      autocapture: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_web_experiments: true,
      // Everything ships in our own bundle (and so in the offline precache) —
      // never pull extra scripts from PostHog's CDN at runtime.
      disable_external_dependency_loading: true,
      // No feature flags in use; skipping the /flags call saves a request.
      advanced_disable_flags: true,
      // Anonymous visitors stay anonymous events — no person profiles.
      person_profiles: "identified_only",
      persistence: "localStorage+cookie",
      respect_dnt: true,
    });
    posthog.register(buildContextProperties());
    return posthog;
  } catch {
    // Blocked by an ad blocker or offline on first load — analytics is
    // best-effort and must never surface as an app error.
    return null;
  }
}

function ensureClient(config: AnalyticsConfig): Promise<PostHog | null> {
  client ??= loadClient(config);
  return client;
}

/**
 * Boot-time entry point (main.tsx). Loads PostHog only when every gate passes;
 * when the user has opted out nothing is downloaded at all.
 */
export async function initAnalytics(): Promise<void> {
  const config = analyticsConfig();
  if (!config) return;
  const gate: AnalyticsGate = {
    configured: true,
    native: isNativeApp(),
    embedded: isEmbedded(),
    optedIn: readUsageStatsPreference(),
  };
  if (!shouldStartAnalytics(gate)) return;
  const posthog = await ensureClient(config);
  // A previous in-session opt-out is persisted by PostHog itself; the Settings
  // toggle is our source of truth, so clear it. Do Not Track still wins inside
  // PostHog's consent check, so this never overrides a browser-level signal.
  if (posthog?.has_opted_out_capturing()) {
    posthog.opt_in_capturing({ captureEventName: false });
  }
}

/**
 * Settings-toggle entry point (useSettings). Opting out stops capture at once;
 * opting back in starts (or first loads) the client.
 */
export function setUsageStatsEnabled(enabled: boolean): void {
  if (!isAnalyticsAvailable()) return;
  const config = analyticsConfig();
  if (!config) return;
  if (!enabled) {
    // Nothing loaded yet means nothing to stop — and we must not load it now.
    if (!client) return;
    void client.then((posthog) => posthog?.opt_out_capturing());
    return;
  }
  void ensureClient(config).then((posthog) => {
    if (posthog?.has_opted_out_capturing()) {
      posthog.opt_in_capturing({ captureEventName: false });
    }
  });
}
