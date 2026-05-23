import { pluginRegistry } from "./registry";
import type { DataViewerPlugin } from "./types";

let initialized = false;

/**
 * Discover and wire every plugin. Each `src/plugins/<name>/index.ts` must
 * default-export a `DataViewerPlugin`. Folders absent at build time (e.g. the
 * private coaching submodule) simply don't appear in the glob, so the app
 * builds and runs without them.
 */
export function initPlugins(): void {
  if (initialized) return;
  initialized = true;

  const modules = import.meta.glob<{ default: DataViewerPlugin }>("./*/index.ts", { eager: true });
  for (const path in modules) {
    const plugin = modules[path]?.default;
    if (plugin?.id) pluginRegistry.register(plugin);
  }

  for (const plugin of pluginRegistry.list()) {
    void plugin.setup?.({ registry: pluginRegistry });
  }

  if (import.meta.env.DEV) {
    const ids = pluginRegistry.list().map((p) => p.id);
    console.info(`[plugins] loaded: ${ids.join(", ") || "none"}`);
  }
}

export { pluginRegistry } from "./registry";
export type { DataViewerPlugin, PluginContext, PluginRegistry } from "./types";
