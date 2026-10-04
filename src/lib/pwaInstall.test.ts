import { describe, it, expect } from "vitest";
import {
  detectInstallState,
  isIosDevice,
  isInstalledApp,
  isSnoozed,
  INSTALL_HINT_SNOOZE_MS,
  type InstallEnvironment,
} from "./pwaInstall";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

describe("isIosDevice", () => {
  it("detects an iPhone", () => {
    expect(isIosDevice({ userAgent: IPHONE })).toBe(true);
  });

  it("detects an iPad hiding behind the desktop-class user agent", () => {
    expect(
      isIosDevice({
        userAgent: IPAD_DESKTOP_UA,
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("does not mistake a real Mac for an iPad", () => {
    expect(
      isIosDevice({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 0 }),
    ).toBe(false);
  });

  it("is false for Android", () => {
    expect(isIosDevice({ userAgent: ANDROID_CHROME, maxTouchPoints: 5 })).toBe(
      false,
    );
  });
});

describe("isInstalledApp", () => {
  it("trusts navigator.standalone (the only signal iOS Safari gives)", () => {
    expect(
      isInstalledApp({ userAgent: IPHONE, navigatorStandalone: true }),
    ).toBe(true);
  });

  it("trusts the standalone display-mode media query", () => {
    expect(
      isInstalledApp({
        userAgent: ANDROID_CHROME,
        displayModeStandalone: true,
      }),
    ).toBe(true);
  });

  it("is false in a plain tab", () => {
    expect(
      isInstalledApp({
        userAgent: IPHONE,
        navigatorStandalone: false,
        displayModeStandalone: false,
      }),
    ).toBe(false);
  });
});

describe("detectInstallState", () => {
  const cases: Array<[string, InstallEnvironment, string]> = [
    [
      "installed iOS app",
      { userAgent: IPHONE, navigatorStandalone: true },
      "installed",
    ],
    [
      "installed Android app",
      { userAgent: ANDROID_CHROME, displayModeStandalone: true },
      "installed",
    ],
    ["iPhone in a Safari tab", { userAgent: IPHONE }, "ios-manual"],
    [
      "iPad in a tab",
      { userAgent: IPAD_DESKTOP_UA, platform: "MacIntel", maxTouchPoints: 5 },
      "ios-manual",
    ],
    ["Android Chrome", { userAgent: ANDROID_CHROME }, "prompt-capable"],
    [
      "desktop",
      { userAgent: MAC, platform: "MacIntel", maxTouchPoints: 0 },
      "prompt-capable",
    ],
  ];

  it.each(cases)("%s → %s", (_name, env, expected) => {
    expect(detectInstallState(env)).toBe(expected);
  });

  it("prefers 'installed' over the iOS hint", () => {
    expect(
      detectInstallState({ userAgent: IPHONE, navigatorStandalone: true }),
    ).toBe("installed");
  });
});

describe("isSnoozed", () => {
  const NOW = 1_800_000_000_000;

  it("is not snoozed with nothing stored", () => {
    expect(isSnoozed(null, NOW)).toBe(false);
  });

  it("suppresses the hint inside the snooze window", () => {
    expect(isSnoozed(String(NOW - 1000), NOW)).toBe(true);
  });

  it("lets the hint back once the window lapses", () => {
    expect(isSnoozed(String(NOW - INSTALL_HINT_SNOOZE_MS - 1), NOW)).toBe(
      false,
    );
  });

  it("ignores a corrupt or future-dated stamp rather than hiding forever", () => {
    expect(isSnoozed("not-a-number", NOW)).toBe(false);
    expect(isSnoozed(String(NOW + 60_000), NOW)).toBe(false);
  });
});
