import { describe, it, expect } from "vitest";
import { missingKeys, extraKeys, placeholderMismatches, type LocaleTree } from "@/lib/i18n/seedUtils";

// The Tools plugin owns its translations under ./locales/. This mirrors the host
// locale-parity test (src/lib/i18n/i18n.test.ts) but scoped to this plugin, so
// the namespace stays self-contained and extraction-ready: every shipped
// language must have exactly the English keys with placeholders preserved.
const localeModules = import.meta.glob<LocaleTree>("./locales/*.json", {
  eager: true,
  import: "default",
});

const locales: Record<string, LocaleTree> = {};
for (const [path, tree] of Object.entries(localeModules)) {
  const code = path.match(/\/locales\/([^/]+)\.json$/)?.[1];
  if (code) locales[code] = tree;
}

const en = locales.en;
const nonEnglish = Object.keys(locales).filter((c) => c !== "en");

describe("tools plugin locale parity", () => {
  it("ships an English source bundle", () => {
    expect(en).toBeDefined();
    expect(nonEnglish.length).toBeGreaterThan(0);
  });

  for (const lng of nonEnglish) {
    it(`${lng} has the same keys as en`, () => {
      expect(missingKeys(en, locales[lng]), `${lng} is missing keys`).toEqual([]);
      expect(extraKeys(en, locales[lng]), `${lng} has extra keys`).toEqual([]);
    });

    it(`${lng} preserves all placeholders/markup`, () => {
      expect(placeholderMismatches(en, locales[lng])).toEqual([]);
    });
  }
});
