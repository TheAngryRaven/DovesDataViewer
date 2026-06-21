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
import type session from "@/locales/en/session.json";
import type video from "@/locales/en/video.json";
import type drawer from "@/locales/en/drawer.json";
import type weather from "@/locales/en/weather.json";
import type tracks from "@/locales/en/tracks.json";
import type plugins from "@/locales/en/plugins.json";
import type auth from "@/locales/en/auth.json";
import type admin from "@/locales/en/admin.json";
import type logger from "@/locales/en/logger.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof common;
      landing: typeof landing;
      settings: typeof settings;
      session: typeof session;
      video: typeof video;
      drawer: typeof drawer;
      weather: typeof weather;
      tracks: typeof tracks;
      plugins: typeof plugins;
      auth: typeof auth;
      admin: typeof admin;
      logger: typeof logger;
    };
  }
}
