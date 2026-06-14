/**
 * i18n configuration: the single source of truth for which languages and
 * translation namespaces exist, plus the pure helpers used to resolve the
 * initial language. Kept free of React and of the i18next instance so it can be
 * imported anywhere (and unit-tested) without side effects.
 */

/** A language we ship translations for. `en` is the source of truth + fallback. */
export type SupportedLanguage = "en" | "es" | "fr" | "de" | "it" | "pt-BR" | "ja";

/** Display metadata for the language picker. `nativeName` is shown to users. */
export interface LanguageOption {
  code: SupportedLanguage;
  /** Endonym — the language's name in its own language. */
  nativeName: string;
  /** English name, for tooltips / accessibility. */
  englishName: string;
}

export const SUPPORTED_LANGUAGES: readonly LanguageOption[] = [
  { code: "en", nativeName: "English", englishName: "English" },
  { code: "es", nativeName: "Español", englishName: "Spanish" },
  { code: "fr", nativeName: "Français", englishName: "French" },
  { code: "de", nativeName: "Deutsch", englishName: "German" },
  { code: "it", nativeName: "Italiano", englishName: "Italian" },
  { code: "pt-BR", nativeName: "Português (Brasil)", englishName: "Portuguese (Brazil)" },
  { code: "ja", nativeName: "日本語", englishName: "Japanese" },
] as const;

export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

/**
 * Translation namespaces. Each maps to a JSON file per language under
 * `src/locales/<lng>/<ns>.json`. New surfaces add a namespace here as they're
 * migrated (see docs/plans/i18n-translation-system.md). `common` is always
 * loaded; the rest load on demand for their surface.
 */
export const NAMESPACES = ["common", "landing", "settings", "session", "video", "drawer", "weather"] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const DEFAULT_NAMESPACE: Namespace = "common";

const SUPPORTED_CODES = new Set<string>(SUPPORTED_LANGUAGES.map((l) => l.code));

/** Narrowing guard: is `code` a language we actually ship? */
export function isSupportedLanguage(code: unknown): code is SupportedLanguage {
  return typeof code === "string" && SUPPORTED_CODES.has(code);
}

/**
 * Map an arbitrary BCP-47 tag (e.g. `navigator.language`) onto a supported
 * language. Exact matches win; otherwise the base subtag is matched (so `es-AR`
 * → `es`, `pt-PT` → `pt-BR` is the closest Portuguese we ship). Returns
 * `undefined` when nothing matches, so callers can fall back deliberately.
 */
export function matchSupportedLanguage(tag: string | undefined | null): SupportedLanguage | undefined {
  if (!tag) return undefined;
  if (isSupportedLanguage(tag)) return tag;

  const base = tag.toLowerCase().split("-")[0];
  // Portuguese: we only ship pt-BR, so any Portuguese variant maps to it.
  if (base === "pt") return "pt-BR";
  const match = SUPPORTED_LANGUAGES.find((l) => l.code.toLowerCase().split("-")[0] === base);
  return match?.code;
}

/**
 * Resolve the language to start in, in priority order:
 *   1. an explicit saved preference (from the settings blob),
 *   2. the browser's preferred languages,
 *   3. the default (English).
 * Pure: callers pass the saved value + browser languages so it stays testable.
 */
export function resolveInitialLanguage(
  savedLanguage: string | undefined | null,
  browserLanguages: readonly string[] = [],
): SupportedLanguage {
  if (isSupportedLanguage(savedLanguage)) return savedLanguage;
  for (const tag of browserLanguages) {
    const matched = matchSupportedLanguage(tag);
    if (matched) return matched;
  }
  return DEFAULT_LANGUAGE;
}
