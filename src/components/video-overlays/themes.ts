import type { ThemeDef, ColorMode } from "./types";

export const THEMES: Record<string, ThemeDef> = {
  classic: {
    id: "classic",
    label: "Classic",
    bg: (mode: ColorMode, opacity: number) =>
      mode === "dark"
        ? `rgba(0, 0, 0, ${0.6 * opacity})`
        : `rgba(255, 255, 255, ${0.7 * opacity})`,
    text: (mode: ColorMode) =>
      mode === "dark" ? "#ffffff" : "#1a1a1a",
    textSecondary: (mode: ColorMode) =>
      mode === "dark" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)",
    accent: (mode: ColorMode) =>
      mode === "dark" ? "#00ccaa" : "#008877",
    border: (mode: ColorMode) =>
      mode === "dark" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)",
    needleColor: (mode: ColorMode) =>
      mode === "dark" ? "#ff4444" : "#cc0000",
    ringColor: (mode: ColorMode) =>
      mode === "dark" ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)",
  },
  neon: {
    id: "neon",
    label: "Neon",
    bg: (mode: ColorMode, opacity: number) =>
      mode === "dark"
        ? `rgba(10, 15, 30, ${0.75 * opacity})`
        : `rgba(240, 245, 255, ${0.8 * opacity})`,
    text: (mode: ColorMode) =>
      mode === "dark" ? "#e0f0ff" : "#0a1530",
    textSecondary: (mode: ColorMode) =>
      mode === "dark" ? "rgba(160,200,255,0.6)" : "rgba(10,21,48,0.5)",
    accent: (mode: ColorMode) =>
      mode === "dark" ? "#00eeff" : "#0088ff",
    border: (mode: ColorMode) =>
      mode === "dark" ? "rgba(0,238,255,0.3)" : "rgba(0,136,255,0.3)",
    needleColor: (mode: ColorMode) =>
      mode === "dark" ? "#ff3366" : "#ff0044",
    ringColor: (mode: ColorMode) =>
      mode === "dark" ? "rgba(0,238,255,0.25)" : "rgba(0,136,255,0.2)",
    glowFilter: "drop-shadow(0 0 4px rgba(0,238,255,0.4))",
  },
};

export function getTheme(id: string): ThemeDef {
  return THEMES[id] ?? THEMES.classic;
}
