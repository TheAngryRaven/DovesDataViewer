// Plugin-local i18n for the Tools plugin. Translations live in ./locales/ (this
// plugin is destined for its own repo, so it owns its strings rather than using
// the host's src/locales/). English is bundled; other languages lazy-load from
// this folder via the host's registerPluginLocale seam. Keys are typed off the
// English JSON, so the plugin keeps compile-time key safety without touching the
// host's i18next type augmentation.

import { useTranslation } from "react-i18next";
import { registerPluginLocale } from "@/lib/i18n/pluginLocales";
import en from "./locales/en.json";

export const TOOLS_NS = "tools";

// Dotted-key union derived from the English bundle (no plural suffixes in this
// namespace, so a straight flatten is exact).
type FlattenKeys<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : FlattenKeys<T[K], `${P}${K}.`>;
}[keyof T & string];
export type ToolsKey = FlattenKeys<typeof en>;

/** Register the Tools namespace with i18next. Called once from the plugin setup. */
export function registerToolsLocale(): void {
  registerPluginLocale(TOOLS_NS, en, {
    es: () => import("./locales/es.json"),
    fr: () => import("./locales/fr.json"),
    de: () => import("./locales/de.json"),
    it: () => import("./locales/it.json"),
    "pt-BR": () => import("./locales/pt-BR.json"),
    ja: () => import("./locales/ja.json"),
  });
}

/** Typed translator scoped to the Tools namespace. */
export function useToolsT(): (key: ToolsKey, opts?: Record<string, unknown>) => string {
  const { t } = useTranslation(TOOLS_NS as never);
  return t as unknown as (key: ToolsKey, opts?: Record<string, unknown>) => string;
}
