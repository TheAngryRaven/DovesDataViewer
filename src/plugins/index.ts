import externalPlugins from "virtual:external-plugins";
import { pluginRegistry } from "./registry";
import { getPluginStore } from "./storage";
import type { DataViewerPlugin } from "./types";

let initialized = false;

/**
 * Discover and wire every plugin from two sources:
 *  1. In-repo first-party plugins — `src/plugins/<name>/index.ts` (glob).
 *  2. External plugins installed as npm packages (the coach), surfaced via the
 *     `virtual:external-plugins` module — see `externalPluginsLoader` in
 *     vite.config.ts. Packages absent at build time simply don't appear, so the
 *     public/Lovable build runs without them.
 *
 * When two plugins share an `id`, higher `priority` wins (private coach > public).
 */
export function initPlugins(): void {
  if (initialized) return;
  initialized = true;

  const modules = import.meta.glob<{ default: DataViewerPlugin }>("./*/index.ts", { eager: true });
  for (const path in modules) {
    const plugin = modules[path]?.default;
    if (plugin?.id) pluginRegistry.register(plugin);
  }

  for (const plugin of externalPlugins) {
    if (plugin?.id) pluginRegistry.register(plugin);
  }

  for (const plugin of pluginRegistry.list()) {
    void plugin.setup?.({ registry: pluginRegistry, storage: getPluginStore(plugin.id) });
  }

  if (import.meta.env.DEV) {
    const ids = pluginRegistry.list().map((p) => p.id);
    console.info(`[plugins] loaded: ${ids.join(", ") || "none"}`);
  }
}

export { pluginRegistry } from "./registry";
export type { DataViewerPlugin, PluginContext, PluginRegistry } from "./types";
