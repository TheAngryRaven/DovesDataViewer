/**
 * Plugin-owned i18n namespaces.
 *
 * A first-party plugin that's destined to live in its own repo (e.g. the Tools
 * plugin) keeps its translations *in its own folder* rather than in the host
 * `src/locales/`. It registers them here: English is added eagerly to i18next
 * (zero flash, always-present fallback), and every other language is a lazy
 * dynamic import from the plugin's own `locales/` dir, resolved through the
 * host backend's `read` (see `importBackend` in `./index.ts`). That keeps the
 * offline-first + lazy + precached guarantees while leaving the plugin fully
 * self-contained — nothing about it depends on the host locale files.
 */
import i18n from "./index";

/** Lazy loader for one (namespace, language) plugin locale chunk. */
export type PluginLocaleLoader = () => Promise<{ default: Record<string, unknown> }>;

const loaders = new Map<string, Record<string, PluginLocaleLoader>>();

/**
 * Register a plugin's own translation namespace. `en` is bundled eagerly;
 * `otherLanguages` maps each non-English code to a dynamic-import loader of that
 * language's JSON in the plugin's folder. Idempotent per namespace.
 */
export function registerPluginLocale(
  namespace: string,
  en: Record<string, unknown>,
  otherLanguages: Record<string, PluginLocaleLoader>,
): void {
  loaders.set(namespace, otherLanguages);
  // deep + overwrite so a re-register (HMR) refreshes the bundle.
  i18n.addResourceBundle("en", namespace, en, true, true);
}

/** The lazy loader for a plugin namespace + language, if one is registered. */
export function getPluginLocaleLoader(
  namespace: string,
  language: string,
): PluginLocaleLoader | undefined {
  return loaders.get(namespace)?.[language];
}

/** Whether a namespace is owned by a plugin (so the backend routes it here). */
export function isPluginNamespace(namespace: string): boolean {
  return loaders.has(namespace);
}
