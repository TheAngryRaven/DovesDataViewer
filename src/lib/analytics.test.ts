import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CaptureResult } from "posthog-js";
import {
  DEFAULT_ANALYTICS_HOST,
  analyticsConfig,
  buildContextProperties,
  hasBrowserOptOut,
  parseUsageStatsPreference,
  scrubEvent,
  scrubPath,
  scrubUrl,
  shouldStartAnalytics,
  takeUsageStatsNotice,
  type AnalyticsGate,
} from "./analytics";
import type { BuildInfo } from "./buildInfo";

const fake = vi.hoisted(() => {
  const state = {
    loads: 0,
    optedOut: false,
    initOptions: null as Record<string, unknown> | null,
    calls: [] as string[],
  };
  const posthog = {
    init: (_key: string, options: Record<string, unknown>) => {
      state.calls.push("init");
      state.initOptions = options;
    },
    register: () => state.calls.push("register"),
    has_opted_out_capturing: () => state.optedOut,
    opt_out_capturing: () => {
      state.calls.push("opt_out");
      state.optedOut = true;
    },
    opt_in_capturing: () => {
      state.calls.push("opt_in");
      state.optedOut = false;
    },
  };
  return { state, posthog };
});

vi.mock("posthog-js", () => {
  fake.state.loads++;
  return { default: fake.posthog };
});

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
  const open: AnalyticsGate = {
    configured: true,
    native: false,
    embedded: false,
    previewHost: false,
    browserOptOut: false,
    optedIn: true,
  };

  it("starts only when every gate passes", () => {
    expect(shouldStartAnalytics(open)).toBe(true);
  });

  it.each<[string, Partial<AnalyticsGate>]>([
    ["no key baked in", { configured: false }],
    ["the native Android shell", { native: true }],
    ["an embedded iframe", { embedded: true }],
    ["a ?nosw=1 preview host", { previewHost: true }],
    ["a Do Not Track / GPC browser", { browserOptOut: true }],
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

const ORIGIN = "https://lapwingdata.com";

describe("scrubPath", () => {
  it("replaces share tokens and driver names with placeholders", () => {
    expect(scrubPath("/s/9f8e7d6c5b4a")).toBe("/s/:token");
    expect(scrubPath("/s/9f8e7d6c5b4a/extra")).toBe("/s/:token/extra");
    expect(scrubPath("/driver/JaneDoe")).toBe("/driver/:username");
  });

  it("leaves ordinary routes alone", () => {
    expect(scrubPath("/")).toBe("/");
    expect(scrubPath("/leaderboards")).toBe("/leaderboards");
    expect(scrubPath("/updates/s/not-a-share")).toBe("/updates/s/not-a-share");
  });
});

describe("scrubUrl", () => {
  it("never lets an auth token in the fragment or query leave the page", () => {
    const callback = `${ORIGIN}/auth/callback#access_token=eyJsecret&refresh_token=r3fresh&type=signup`;
    expect(scrubUrl(callback, ORIGIN)).toBe(`${ORIGIN}/auth/callback`);
    expect(scrubUrl(`${ORIGIN}/reset-password?token=abc#access_token=x`, ORIGIN)).toBe(
      `${ORIGIN}/reset-password`,
    );
  });

  it("rewrites share links and driver pages on our own origin", () => {
    expect(scrubUrl(`${ORIGIN}/s/sharetoken123?x=1`, ORIGIN)).toBe(`${ORIGIN}/s/:token`);
    expect(scrubUrl(`${ORIGIN}/driver/JaneDoe`, ORIGIN)).toBe(`${ORIGIN}/driver/:username`);
  });

  it("cuts other sites' URLs (referrers) to their origin", () => {
    expect(scrubUrl("https://forum.example.com/thread/42?user=jane#post", ORIGIN)).toBe(
      "https://forum.example.com",
    );
    // A share link on a different deploy is still somebody's secret.
    expect(scrubUrl("https://beta.lapwingdata.com/s/token", ORIGIN)).toBe("https://beta.lapwingdata.com");
  });

  it("scrubs bare paths too", () => {
    expect(scrubUrl("/s/token?a=b#c", ORIGIN)).toBe("/s/:token");
    expect(scrubUrl("/leaderboards#top", ORIGIN)).toBe("/leaderboards");
  });

  it("keeps the values PostHog uses for 'no referrer' and bare referring domains", () => {
    expect(scrubUrl("$direct", ORIGIN)).toBe("$direct");
    expect(scrubUrl("", ORIGIN)).toBe("");
    expect(scrubUrl("forum.example.com", ORIGIN)).toBe("forum.example.com");
  });

  it("drops anything it cannot safely reduce", () => {
    expect(scrubUrl("javascript:alert(1)", ORIGIN)).toBeNull();
    expect(scrubUrl("data:text/plain,hello", ORIGIN)).toBeNull();
    expect(scrubUrl("not a url ?token=1", ORIGIN)).toBeNull();
  });
});

describe("scrubEvent", () => {
  const event = (): CaptureResult =>
    ({
      uuid: "u",
      event: "$pageview",
      properties: {
        $current_url: `${ORIGIN}/s/secret-token#access_token=abc`,
        $pathname: "/s/secret-token",
        $referrer: "https://search.example/?q=jane+doe+lap+times",
        $referring_domain: "search.example",
        $prev_pageview_pathname: "/driver/JaneDoe",
        $host: "lapwingdata.com",
        title: "Jane Doe — Session",
        $title: "Jane Doe — Session",
        app_channel: "production",
      },
      $set: { $current_url: `${ORIGIN}/auth/callback#refresh_token=r` },
      $set_once: {
        $initial_current_url: `${ORIGIN}/s/first-token?ref=x`,
        $initial_referrer: "https://mail.example/inbox/123",
        $initial_title: "Private",
      },
    }) as unknown as CaptureResult;

  it("scrubs every URL-shaped property, including $set and $set_once", () => {
    const out = scrubEvent(event(), ORIGIN);
    expect(out?.properties).toEqual({
      $current_url: `${ORIGIN}/s/:token`,
      $pathname: "/s/:token",
      $referrer: "https://search.example",
      $referring_domain: "search.example",
      $prev_pageview_pathname: "/driver/:username",
      $host: "lapwingdata.com",
      app_channel: "production",
    });
    expect(out?.$set).toEqual({ $current_url: `${ORIGIN}/auth/callback` });
    expect(out?.$set_once).toEqual({
      $initial_current_url: `${ORIGIN}/s/:token`,
      $initial_referrer: "https://mail.example",
    });
  });

  it("leaves no secret anywhere in the serialized event", () => {
    const json = JSON.stringify(scrubEvent(event(), ORIGIN));
    for (const secret of ["secret-token", "access_token", "refresh_token", "JaneDoe", "jane", "first-token", "123"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("passes a null (already dropped) event through", () => {
    expect(scrubEvent(null, ORIGIN)).toBeNull();
  });
});

describe("hasBrowserOptOut", () => {
  it("is false when no signal is set", () => {
    expect(hasBrowserOptOut({})).toBe(false);
    expect(hasBrowserOptOut({ doNotTrack: "0", globalPrivacyControl: false })).toBe(false);
    expect(hasBrowserOptOut({ doNotTrack: "unspecified", windowDoNotTrack: null })).toBe(false);
  });

  it.each<[string, Parameters<typeof hasBrowserOptOut>[0]]>([
    ["navigator.doNotTrack", { doNotTrack: "1" }],
    ["old Firefox's 'yes'", { doNotTrack: "yes" }],
    ["IE's msDoNotTrack", { msDoNotTrack: "1" }],
    ["Safari's window.doNotTrack", { windowDoNotTrack: "1" }],
    ["Global Privacy Control", { globalPrivacyControl: true }],
  ])("honours %s", (_label, signals) => {
    expect(hasBrowserOptOut(signals)).toBe(true);
  });
});

describe("takeUsageStatsNotice", () => {
  const memoryStorage = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  };

  it("answers true exactly once per browser", () => {
    const storage = memoryStorage();
    expect(takeUsageStatsNotice(storage)).toBe(true);
    expect(takeUsageStatsNotice(storage)).toBe(false);
    expect(takeUsageStatsNotice(storage)).toBe(false);
  });

  it("stays quiet when storage is unavailable", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(takeUsageStatsNotice(broken)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Runtime: boot, gates and the Settings toggle, against a mocked posthog-js.
// ---------------------------------------------------------------------------

interface PageOptions {
  search?: string;
  doNotTrack?: string;
  globalPrivacyControl?: boolean;
  embedded?: boolean;
  settings?: Record<string, unknown>;
  storage?: Record<string, string>;
  cookies?: string[];
}

function installPage(opts: PageOptions = {}) {
  const store = new Map<string, string>(Object.entries(opts.storage ?? {}));
  if (opts.settings) store.set("dove-dataviewer-settings", JSON.stringify(opts.settings));
  const localStorage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const jar = new Map<string, string>(
    (opts.cookies ?? []).map((c) => [c.split("=", 1)[0], c.slice(c.indexOf("=") + 1)]),
  );
  const document = {
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(value: string) {
      const [pair] = value.split(";");
      const name = pair.split("=", 1)[0].trim();
      if (/Max-Age=0/i.test(value)) jar.delete(name);
      else jar.set(name, pair.slice(pair.indexOf("=") + 1));
    },
  };
  const win: Record<string, unknown> = {
    location: { search: opts.search ?? "", hostname: "lapwingdata.com", origin: ORIGIN },
    matchMedia: () => ({ matches: false }),
  };
  win.self = win;
  win.top = opts.embedded ? {} : win;
  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", {
    doNotTrack: opts.doNotTrack ?? null,
    globalPrivacyControl: opts.globalPrivacyControl ?? false,
  });
  return { store, jar };
}

async function loadModule() {
  vi.resetModules();
  return import("./analytics");
}

describe("analytics runtime", () => {
  beforeEach(() => {
    fake.state.loads = 0;
    fake.state.optedOut = false;
    fake.state.initOptions = null;
    fake.state.calls = [];
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    vi.stubEnv("VITE_POSTHOG_HOST", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("starts cookieless, pageviews-only, with the scrubber wired in", async () => {
    installPage();
    const analytics = await loadModule();
    expect(await analytics.initAnalytics()).toBe(true);
    expect(fake.state.calls).toEqual(["init", "register"]);
    const options = fake.state.initOptions!;
    expect(options).toMatchObject({
      api_host: DEFAULT_ANALYTICS_HOST,
      cookieless_mode: "always",
      autocapture: false,
      disable_session_recording: true,
      disable_external_dependency_loading: true,
      respect_dnt: true,
      person_profiles: "identified_only",
    });
    const beforeSend = options.before_send as (e: CaptureResult | null) => CaptureResult | null;
    const sent = beforeSend({
      properties: { $current_url: `${ORIGIN}/auth/callback#access_token=abc` },
    } as unknown as CaptureResult);
    expect(sent?.properties.$current_url).toBe(`${ORIGIN}/auth/callback`);
  });

  it.each<[string, PageOptions]>([
    ["the user opted out", { settings: { sendUsageStats: false } }],
    ["Do Not Track is on", { doNotTrack: "1" }],
    ["Global Privacy Control is on", { globalPrivacyControl: true }],
    ["a ?nosw=1 preview host", { search: "?nosw=1" }],
    ["an iframe", { embedded: true }],
  ])("never downloads PostHog when %s", async (_label, page) => {
    installPage(page);
    const analytics = await loadModule();
    expect(await analytics.initAnalytics()).toBe(false);
    expect(fake.state.loads).toBe(0);
    expect(fake.state.calls).toEqual([]);
  });

  it("never downloads PostHog when no key is baked in", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    installPage();
    const analytics = await loadModule();
    expect(await analytics.initAnalytics()).toBe(false);
    expect(fake.state.loads).toBe(0);
  });

  it("clears identifiers an earlier build stored, on boot", async () => {
    const { store, jar } = installPage({
      storage: { ph_phc_test_posthog: '{"distinct_id":"abc"}', "lapwing-other": "keep" },
      cookies: ["ph_phc_test_posthog=%7B%7D", "sb-session=keep"],
    });
    const analytics = await loadModule();
    await analytics.initAnalytics();
    expect([...store.keys()]).toEqual(["lapwing-other"]);
    expect([...jar.keys()]).toEqual(["sb-session"]);
  });

  it("switching it off before anything loaded does not load PostHog", async () => {
    installPage({ settings: { sendUsageStats: false } });
    const analytics = await loadModule();
    await analytics.initAnalytics();
    analytics.setUsageStatsEnabled(false);
    await Promise.resolve();
    expect(fake.state.loads).toBe(0);
  });

  it("switching it off after load stops capture and clears identifiers", async () => {
    const { store } = installPage();
    const analytics = await loadModule();
    await analytics.initAnalytics();
    store.set("ph_leftover", "x");
    analytics.setUsageStatsEnabled(false);
    await vi.waitFor(() => expect(fake.state.calls).toContain("opt_out"));
    expect(store.has("ph_leftover")).toBe(false);
  });

  it("switching it back on resumes capture", async () => {
    installPage();
    const analytics = await loadModule();
    await analytics.initAnalytics();
    analytics.setUsageStatsEnabled(false);
    await vi.waitFor(() => expect(fake.state.optedOut).toBe(true));
    analytics.setUsageStatsEnabled(true);
    await vi.waitFor(() => expect(fake.state.optedOut).toBe(false));
  });

  it("switching it on starts PostHog only after boot, and only where boot would", async () => {
    installPage({ search: "?nosw=1" });
    let analytics = await loadModule();
    analytics.setUsageStatsEnabled(true);
    await analytics.initAnalytics();
    analytics.setUsageStatsEnabled(true);
    await Promise.resolve();
    expect(fake.state.loads).toBe(0);

    installPage({ settings: { sendUsageStats: false } });
    analytics = await loadModule();
    // Before boot: the toggle alone never starts it.
    analytics.setUsageStatsEnabled(true);
    await Promise.resolve();
    expect(fake.state.calls).toEqual([]);
    await analytics.initAnalytics();
    analytics.setUsageStatsEnabled(true);
    await vi.waitFor(() => expect(fake.state.calls).toContain("init"));
  });

  it("a load failure (ad blocker, offline) is swallowed", async () => {
    installPage();
    const analytics = await loadModule();
    const init = vi.spyOn(fake.posthog, "init").mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(await analytics.initAnalytics()).toBe(false);
    init.mockRestore();
  });

  it("isAnalyticsAvailable hides the toggle on previews but not on DNT browsers", async () => {
    installPage({ doNotTrack: "1" });
    let analytics = await loadModule();
    expect(analytics.isAnalyticsAvailable()).toBe(true);
    installPage({ search: "?nosw=1" });
    analytics = await loadModule();
    expect(analytics.isAnalyticsAvailable()).toBe(false);
  });
});
