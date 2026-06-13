/**
 * i18next bootstrap. Imported once from `main.tsx` before render so the chosen
 * language is set before first paint (no English flash).
 *
 * Strategy (see docs/plans/i18n-translation-system.md):
 *   - English is bundled eagerly as in-memory `resources` — it's the fallback
 *     language and must always be present with zero network/flash.
 *   - Every other language loads lazily through `importBackend` below, which
 *     dynamic-imports `src/locales/<lng>/<ns>.json`. Vite code-splits each into
 *     its own chunk; the service worker precaches those JS chunks (the worker's
 *     JS glob), so switching language works fully offline after the first
 *     install — no runtime fetch, no eager bundle cost.
 */
import i18n from "i18next";
import type { BackendModule, ReadCallback } from "i18next";
import { initReactI18next } from "react-i18next";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_NAMESPACE,
  NAMESPACES,
  resolveInitialLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "./config";

import enCommon from "@/locales/en/common.json";
import enLanding from "@/locales/en/landing.json";
import enSettings from "@/locales/en/settings.json";
import enSession from "@/locales/en/session.json";

const SETTINGS_KEY = "dove-dataviewer-settings";

/** Read the persisted language preference straight from the settings blob,
 * synchronously, so we can pick it before React mounts (mirrors the darkMode
 * bootstrap in App.tsx). Returns undefined if unset/malformed. */
function readSavedLanguage(): string | undefined {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { language?: unknown };
    return typeof parsed.language === "string" ? parsed.language : undefined;
  } catch {
    return undefined;
  }
}

const bundledEnglish = {
  common: enCommon,
  landing: enLanding,
  settings: enSettings,
  session: enSession,
} as const;

const importBackend: BackendModule = {
  type: "backend",
  init: () => undefined,
  read: (language: string, namespace: string, callback: ReadCallback) => {
    import(`../../locales/${language}/${namespace}.json`)
      .then((mod) => callback(null, mod.default))
      .catch((err: unknown) => callback(err as Error, false));
  },
};

export const initialLanguage: SupportedLanguage = resolveInitialLanguage(
  readSavedLanguage(),
  typeof navigator !== "undefined"
    ? (navigator.languages ?? (navigator.language ? [navigator.language] : []))
    : [],
);

void i18n
  .use(importBackend)
  .use(initReactI18next)
  .init({
    lng: initialLanguage,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    // Don't expand pt-BR → pt; our codes are explicit.
    load: "currentOnly",
    nonExplicitSupportedLngs: false,
    ns: NAMESPACES,
    defaultNS: DEFAULT_NAMESPACE,
    resources: { en: bundledEnglish },
    // English is bundled; every other language is filled in by the backend.
    partialBundledLanguages: true,
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    react: { useSuspense: false },
  });

// Keep <html lang> in sync for accessibility / SEO.
const applyHtmlLang = (lng: string) => {
  if (typeof document !== "undefined") document.documentElement.setAttribute("lang", lng);
};
applyHtmlLang(initialLanguage);
i18n.on("languageChanged", applyHtmlLang);

export default i18n;
