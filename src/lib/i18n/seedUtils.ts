/**
 * Pure helpers for the translation-seeding pipeline (scripts/seed-translations.mjs)
 * and the locale-parity tests. Kept dependency-free so both a Node script and
 * Vitest can use them.
 *
 * Conventions:
 *   - Keys whose segment starts with `_` are *metadata* (e.g. the `_machine`
 *     provenance flag), not translatable strings — they're skipped everywhere.
 *   - A "placeholder" is either an i18next interpolation (`{{name}}`) or a
 *     `<Trans>` markup tag (`<strong>` / `<0>`). Translations must preserve the
 *     exact set the English source uses, or interpolation/markup breaks.
 */

export type LocaleTree = { [key: string]: string | number | boolean | LocaleTree };

const isMetaKey = (key: string) => key.startsWith("_");

/**
 * Flatten a nested locale object into `{ "a.b.c": value }`, skipping metadata
 * keys and non-string leaves. Dot-joined paths match how i18next addresses keys.
 */
export function flattenLocale(tree: LocaleTree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    if (isMetaKey(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") {
      Object.assign(out, flattenLocale(value, path));
    } else if (typeof value === "string") {
      out[path] = value;
    }
  }
  return out;
}

/** Leaf key paths present in `source` but absent from `target`. */
export function missingKeys(source: LocaleTree, target: LocaleTree): string[] {
  const t = flattenLocale(target);
  return Object.keys(flattenLocale(source)).filter((k) => !(k in t));
}

/** Leaf key paths present in `target` but not in `source` (stale/extra). */
export function extraKeys(source: LocaleTree, target: LocaleTree): string[] {
  const s = flattenLocale(source);
  return Object.keys(flattenLocale(target)).filter((k) => !(k in s));
}

const INTERPOLATION = /\{\{\s*[^}]+?\s*\}\}/g;
const TAG = /<\/?[^>]+?>/g;

/** The sorted, de-duplicated set of placeholders/markup tokens in a string. */
export function placeholdersOf(value: string): string[] {
  const interpolations = (value.match(INTERPOLATION) ?? []).map((m) => m.replace(/\s+/g, ""));
  const tags = value.match(TAG) ?? [];
  return Array.from(new Set([...interpolations, ...tags])).sort();
}

export interface PlaceholderMismatch {
  key: string;
  missing: string[];
  extra: string[];
}

/**
 * For every key the two locales share, compare placeholder sets. A mismatch
 * means the translation dropped or invented an interpolation/markup token.
 */
export function placeholderMismatches(source: LocaleTree, target: LocaleTree): PlaceholderMismatch[] {
  const s = flattenLocale(source);
  const t = flattenLocale(target);
  const mismatches: PlaceholderMismatch[] = [];
  for (const [key, value] of Object.entries(s)) {
    if (!(key in t)) continue;
    const expected = placeholdersOf(value);
    const got = placeholdersOf(t[key]);
    const missing = expected.filter((p) => !got.includes(p));
    const extra = got.filter((p) => !expected.includes(p));
    if (missing.length || extra.length) mismatches.push({ key, missing, extra });
  }
  return mismatches;
}
