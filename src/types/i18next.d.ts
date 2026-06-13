/**
 * Compile-time translation-key safety. Augments react-i18next's resource type
 * with the English (source-of-truth) JSON shape, so `t("settings:title")` and
 * friends are autocompleted and a missing/renamed key fails `tsc -b`.
 *
 * The English files are the canonical key set; other languages are validated
 * against them at test time (see src/lib/i18n/i18n.test.ts).
 */
import type common from "@/locales/en/common.json";
import type landing from "@/locales/en/landing.json";
import type settings from "@/locales/en/settings.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof common;
      landing: typeof landing;
      settings: typeof settings;
    };
  }
}
