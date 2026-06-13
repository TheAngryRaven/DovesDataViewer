import { describe, it, expect } from "vitest";
import {
  isSupportedLanguage,
  matchSupportedLanguage,
  resolveInitialLanguage,
  SUPPORTED_LANGUAGES,
  NAMESPACES,
  DEFAULT_LANGUAGE,
} from "./config";
import {
  flattenLocale,
  missingKeys,
  extraKeys,
  placeholdersOf,
  placeholderMismatches,
  type LocaleTree,
} from "./seedUtils";

// Eagerly load every committed locale file so the parity checks see the real
// shipped translations (not a hand-maintained list that could drift).
const localeModules = import.meta.glob<LocaleTree>("../../locales/*/*.json", {
  eager: true,
  import: "default",
});

/** locales[lng][ns] = parsed tree, derived from the file paths. */
const locales: Record<string, Record<string, LocaleTree>> = {};
for (const [path, tree] of Object.entries(localeModules)) {
  const match = path.match(/\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, lng, ns] = match;
  (locales[lng] ??= {})[ns] = tree;
}

const nonEnglish = SUPPORTED_LANGUAGES.map((l) => l.code).filter((c) => c !== "en");

describe("config: language resolution", () => {
  it("recognises every shipped language code", () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      expect(isSupportedLanguage(code)).toBe(true);
    }
    expect(isSupportedLanguage("xx")).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
  });

  it("matches regional variants onto a shipped base language", () => {
    expect(matchSupportedLanguage("es-AR")).toBe("es");
    expect(matchSupportedLanguage("fr-CA")).toBe("fr");
    expect(matchSupportedLanguage("de-AT")).toBe("de");
    expect(matchSupportedLanguage("ja")).toBe("ja");
    // We only ship pt-BR, so any Portuguese maps to it.
    expect(matchSupportedLanguage("pt-PT")).toBe("pt-BR");
    expect(matchSupportedLanguage("zh-CN")).toBeUndefined();
    expect(matchSupportedLanguage(undefined)).toBeUndefined();
  });

  it("prefers a saved preference, then browser languages, then the default", () => {
    expect(resolveInitialLanguage("de", ["fr-FR"])).toBe("de");
    expect(resolveInitialLanguage(null, ["fr-FR", "en"])).toBe("fr");
    expect(resolveInitialLanguage(undefined, ["zh-CN", "it-IT"])).toBe("it");
    expect(resolveInitialLanguage(undefined, [])).toBe(DEFAULT_LANGUAGE);
    // A bogus saved value is ignored in favour of the browser/default.
    expect(resolveInitialLanguage("klingon", ["es"])).toBe("es");
  });
});

describe("seedUtils", () => {
  const source: LocaleTree = {
    _machine: true,
    a: "hi {{name}}",
    nested: { b: "<strong>x</strong>", c: "plain" },
  };

  it("flattens nested trees and skips metadata keys", () => {
    expect(flattenLocale(source)).toEqual({
      a: "hi {{name}}",
      "nested.b": "<strong>x</strong>",
      "nested.c": "plain",
    });
  });

  it("detects missing and extra keys", () => {
    const target: LocaleTree = { a: "hola {{name}}", nested: { b: "<strong>x</strong>" } };
    expect(missingKeys(source, target)).toEqual(["nested.c"]);
    expect(extraKeys(source, target)).toEqual([]);
    expect(extraKeys({ a: "x" }, target)).toEqual(["nested.b"]);
  });

  it("extracts interpolation and markup placeholders, whitespace-insensitive", () => {
    expect(placeholdersOf("hi {{ name }} and {{count}}")).toEqual(["{{count}}", "{{name}}"]);
    expect(placeholdersOf("a <strong>b</strong> c")).toEqual(["</strong>", "<strong>"]);
  });

  it("flags placeholder mismatches between source and target", () => {
    const target: LocaleTree = {
      a: "hola",
      nested: { b: "<em>x</em>", c: "plano" },
    };
    const result = placeholderMismatches(source, target);
    const byKey = Object.fromEntries(result.map((m) => [m.key, m]));
    expect(byKey["a"].missing).toEqual(["{{name}}"]);
    expect(byKey["nested.b"].missing).toEqual(["</strong>", "<strong>"]);
    expect(byKey["nested.b"].extra).toEqual(["</em>", "<em>"]);
    expect(byKey["nested.c"]).toBeUndefined();
  });
});

describe("locale parity (every language matches the English source)", () => {
  it("ships English for every namespace", () => {
    for (const ns of NAMESPACES) {
      expect(locales.en?.[ns], `en/${ns}.json should exist`).toBeTruthy();
    }
  });

  for (const lng of nonEnglish) {
    for (const ns of NAMESPACES) {
      it(`${lng}/${ns} has the same keys as en/${ns}`, () => {
        const en = locales.en[ns];
        const target = locales[lng]?.[ns];
        expect(target, `${lng}/${ns}.json should exist`).toBeTruthy();
        expect(missingKeys(en, target!), `${lng}/${ns} is missing keys`).toEqual([]);
        expect(extraKeys(en, target!), `${lng}/${ns} has extra keys`).toEqual([]);
      });

      it(`${lng}/${ns} preserves all placeholders/markup`, () => {
        const en = locales.en[ns];
        const target = locales[lng][ns];
        expect(placeholderMismatches(en, target)).toEqual([]);
      });
    }
  }
});
