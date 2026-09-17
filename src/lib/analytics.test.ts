import { describe, it, expect } from "vitest";
import {
  DEFAULT_ANALYTICS_HOST,
  analyticsConfig,
  buildContextProperties,
  parseUsageStatsPreference,
  shouldStartAnalytics,
  type AnalyticsGate,
} from "./analytics";
import type { BuildInfo } from "./buildInfo";

describe("analyticsConfig", () => {
  it("is null when no key is baked in — self-hosters and local dev report nothing", () => {
    expect(analyticsConfig({})).toBeNull();
    expect(analyticsConfig({ VITE_POSTHOG_KEY: "" })).toBeNull();
    expect(analyticsConfig({ VITE_POSTHOG_KEY: "   " })).toBeNull();
  });

  it("defaults the host to PostHog's US cloud", () => {
    expect(analyticsConfig({ VITE_POSTHOG_KEY: "phc_abc" })).toEqual({
      key: "phc_abc",
      host: DEFAULT_ANALYTICS_HOST,
    });
  });

  it("accepts a custom host (a reverse proxy or the EU cloud) and strips a trailing slash", () => {
    expect(
      analyticsConfig({ VITE_POSTHOG_KEY: " phc_abc ", VITE_POSTHOG_HOST: "https://eu.i.posthog.com/" }),
    ).toEqual({ key: "phc_abc", host: "https://eu.i.posthog.com" });
    // Blank host falls back rather than producing an empty api_host.
    expect(analyticsConfig({ VITE_POSTHOG_KEY: "phc_abc", VITE_POSTHOG_HOST: "  " })?.host).toBe(
      DEFAULT_ANALYTICS_HOST,
    );
  });
});

describe("shouldStartAnalytics", () => {
  const open: AnalyticsGate = { configured: true, native: false, embedded: false, optedIn: true };

  it("starts only when every gate passes", () => {
    expect(shouldStartAnalytics(open)).toBe(true);
  });

  it.each<[string, Partial<AnalyticsGate>]>([
    ["no key baked in", { configured: false }],
    ["the native Android shell", { native: true }],
    ["an embedded iframe", { embedded: true }],
    ["the user opted out", { optedIn: false }],
  ])("never starts for %s", (_label, override) => {
    expect(shouldStartAnalytics({ ...open, ...override })).toBe(false);
  });
});

describe("parseUsageStatsPreference", () => {
  it("defaults to on when nothing is stored", () => {
    expect(parseUsageStatsPreference(null)).toBe(true);
    expect(parseUsageStatsPreference(undefined)).toBe(true);
    expect(parseUsageStatsPreference("")).toBe(true);
  });

  it("defaults to on for settings saved before the toggle existed", () => {
    expect(parseUsageStatsPreference(JSON.stringify({ darkMode: true }))).toBe(true);
  });

  it("honours an explicit opt-out", () => {
    expect(parseUsageStatsPreference(JSON.stringify({ sendUsageStats: false }))).toBe(false);
    expect(parseUsageStatsPreference(JSON.stringify({ sendUsageStats: true }))).toBe(true);
  });

  it("treats malformed or non-boolean values as the default", () => {
    expect(parseUsageStatsPreference("{not json")).toBe(true);
    expect(parseUsageStatsPreference(JSON.stringify({ sendUsageStats: "no" }))).toBe(true);
    expect(parseUsageStatsPreference(JSON.stringify(null))).toBe(true);
    expect(parseUsageStatsPreference(JSON.stringify([false]))).toBe(true);
  });
});

describe("buildContextProperties", () => {
  const base: BuildInfo = {
    version: "4.2.0",
    commit: "abc1234",
    buildDate: "",
    branch: "main",
    commitDate: "",
  };

  it("tags production builds and browser-tab launches", () => {
    expect(buildContextProperties(base, false)).toEqual({
      app_version: "4.2.0",
      app_channel: "production",
      app_display_mode: "browser",
    });
  });

  it("tags beta/preview deploys so one project can be filtered by channel", () => {
    expect(buildContextProperties({ ...base, branch: "BETA" }, false).app_channel).toBe("preview");
    expect(buildContextProperties({ ...base, branch: "feature/x" }, false).app_channel).toBe("preview");
    // An unknown branch mirrors isPreviewBuild: treated as production.
    expect(buildContextProperties({ ...base, branch: "unknown" }, false).app_channel).toBe("production");
  });

  it("distinguishes an installed PWA from a browser tab", () => {
    expect(buildContextProperties(base, true).app_display_mode).toBe("standalone");
  });
});
