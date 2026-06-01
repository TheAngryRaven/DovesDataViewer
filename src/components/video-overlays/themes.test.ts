import { describe, it, expect } from "vitest";
import { THEMES, getTheme } from "./themes";
import type { ColorMode } from "./types";

// ─── THEMES registry shape ──────────────────────────────────────────────────

describe("THEMES", () => {
  it("defines exactly the classic and neon themes", () => {
    expect(Object.keys(THEMES).sort()).toEqual(["classic", "neon"]);
  });

  it("each theme's id matches its registry key", () => {
    for (const [key, theme] of Object.entries(THEMES)) {
      expect(theme.id).toBe(key);
    }
  });

  it("each theme exposes a human label", () => {
    expect(THEMES.classic.label).toBe("Classic");
    expect(THEMES.neon.label).toBe("Neon");
  });

  it("only neon carries a glowFilter (classic has none)", () => {
    expect(THEMES.classic.glowFilter).toBeUndefined();
    expect(THEMES.neon.glowFilter).toContain("drop-shadow");
  });
});

// ─── getTheme lookup ──────────────────────────────────────────────────────────

describe("getTheme", () => {
  it("returns the matching theme by id", () => {
    expect(getTheme("classic")).toBe(THEMES.classic);
    expect(getTheme("neon")).toBe(THEMES.neon);
  });

  it("falls back to classic for an unknown id", () => {
    expect(getTheme("does-not-exist")).toBe(THEMES.classic);
    expect(getTheme("")).toBe(THEMES.classic);
  });
});

// ─── color helper functions ─────────────────────────────────────────────────

describe("theme color helpers", () => {
  const modes: ColorMode[] = ["light", "dark"];

  it("bg() scales alpha by opacity (classic dark = 0.6 * opacity)", () => {
    expect(THEMES.classic.bg("dark", 1)).toBe("rgba(0, 0, 0, 0.6)");
    expect(THEMES.classic.bg("dark", 0.5)).toBe("rgba(0, 0, 0, 0.3)");
    expect(THEMES.classic.bg("dark", 0)).toBe("rgba(0, 0, 0, 0)");
  });

  it("bg() light mode uses a different base alpha (classic light = 0.7 * opacity)", () => {
    expect(THEMES.classic.bg("light", 1)).toBe("rgba(255, 255, 255, 0.7)");
    expect(THEMES.classic.bg("light", 0.5)).toBe("rgba(255, 255, 255, 0.35)");
  });

  it("neon bg() differs between light and dark and scales by opacity", () => {
    expect(THEMES.neon.bg("dark", 1)).toBe("rgba(10, 15, 30, 0.75)");
    expect(THEMES.neon.bg("light", 1)).toBe("rgba(240, 245, 255, 0.8)");
    expect(THEMES.neon.bg("dark", 1)).not.toBe(THEMES.neon.bg("light", 1));
  });

  it("text() returns light text in dark mode and dark text in light mode", () => {
    expect(THEMES.classic.text("dark")).toBe("#ffffff");
    expect(THEMES.classic.text("light")).toBe("#1a1a1a");
    expect(THEMES.neon.text("dark")).toBe("#e0f0ff");
    expect(THEMES.neon.text("light")).toBe("#0a1530");
  });

  it("every color helper returns a non-empty string for both modes", () => {
    const helpers = [
      "text",
      "textSecondary",
      "accent",
      "border",
      "needleColor",
      "ringColor",
    ] as const;
    for (const theme of Object.values(THEMES)) {
      for (const mode of modes) {
        for (const h of helpers) {
          const out = theme[h](mode);
          expect(typeof out).toBe("string");
          expect(out.length).toBeGreaterThan(0);
        }
        // bg takes an extra opacity arg
        expect(typeof theme.bg(mode, 1)).toBe("string");
      }
    }
  });

  it("dark and light variants of each helper differ (themes are mode-aware)", () => {
    for (const theme of Object.values(THEMES)) {
      expect(theme.accent("dark")).not.toBe(theme.accent("light"));
      expect(theme.text("dark")).not.toBe(theme.text("light"));
    }
  });
});
