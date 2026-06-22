import { describe, it, expect, vi } from "vitest";
import {
  isTauri,
  isNativeBuild,
  isNativeApp,
  openExternal,
  interceptExternal,
  type NativeBridge,
} from "./platform";

// Tauri's opener plugin is dynamically imported by openExternal; mock it so the
// native-without-bridge path is observable without a real Tauri runtime.
const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

// A minimal stand-in for `window`; only the bits each helper touches are set.
const fakeWindow = (over: Partial<Window> = {}): Window => over as unknown as Window;

describe("isTauri", () => {
  it("is true when the Tauri v2 global is present", () => {
    expect(isTauri(fakeWindow({ __TAURI_INTERNALS__: {} }))).toBe(true);
  });
  it("is true when the legacy v1 global is present", () => {
    expect(isTauri(fakeWindow({ __TAURI__: {} }))).toBe(true);
  });
  it("is false without either global, or with no window", () => {
    expect(isTauri(fakeWindow())).toBe(false);
    expect(isTauri(undefined)).toBe(false);
  });
});

describe("isNativeBuild", () => {
  it("is true only when VITE_IS_NATIVE is the string 'true'", () => {
    expect(isNativeBuild({ VITE_IS_NATIVE: "true" })).toBe(true);
    expect(isNativeBuild({ VITE_IS_NATIVE: "false" })).toBe(false);
    expect(isNativeBuild({})).toBe(false);
  });
});

describe("isNativeApp", () => {
  it("is true for a native build regardless of the runtime", () => {
    expect(isNativeApp({ VITE_IS_NATIVE: "true" }, fakeWindow())).toBe(true);
  });
  it("is true for a Tauri runtime regardless of the build flag", () => {
    expect(isNativeApp({ VITE_IS_NATIVE: "false" }, fakeWindow({ __TAURI_INTERNALS__: {} }))).toBe(true);
  });
  it("is false on the plain web (no flag, no runtime)", () => {
    expect(isNativeApp({ VITE_IS_NATIVE: "false" }, fakeWindow())).toBe(false);
  });
});

describe("openExternal", () => {
  it("opens a new tab on the web", () => {
    const open = vi.fn();
    openExternal("https://example.com", fakeWindow({ open }));
    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
  });

  it("routes through the native bridge inside a Tauri runtime", () => {
    const bridge: NativeBridge = { openExternal: vi.fn() };
    const open = vi.fn();
    openExternal("https://example.com", fakeWindow({ __TAURI_INTERNALS__: {}, __HTT_NATIVE__: bridge, open }));
    expect(bridge.openExternal).toHaveBeenCalledWith("https://example.com");
    expect(open).not.toHaveBeenCalled();
  });

  it("routes through the Tauri opener plugin on native when no bridge is wired up", async () => {
    openUrl.mockResolvedValueOnce(undefined);
    const open = vi.fn();
    openExternal("https://example.com", fakeWindow({ __TAURI_INTERNALS__: {}, open }));
    // Never opened in the app's own WebView — handed to the opener plugin instead.
    expect(open).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.com"));
  });
});

describe("interceptExternal", () => {
  it("cancels the anchor and routes to the bridge on native", () => {
    const bridge: NativeBridge = { openExternal: vi.fn() };
    const preventDefault = vi.fn();
    interceptExternal({ preventDefault }, "https://example.com", fakeWindow({ __TAURI_INTERNALS__: {}, __HTT_NATIVE__: bridge }));
    expect(preventDefault).toHaveBeenCalled();
    expect(bridge.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("is a no-op on the web (lets the anchor open a new tab itself)", () => {
    const preventDefault = vi.fn();
    interceptExternal({ preventDefault }, "https://example.com", fakeWindow());
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
