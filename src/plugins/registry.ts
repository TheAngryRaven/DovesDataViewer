import type { DataViewerPlugin, PluginRegistry } from "./types";

class Registry implements PluginRegistry {
  private plugins = new Map<string, DataViewerPlugin>();
  private contributions = new Map<string, unknown[]>();
  // Bumped on every contribution so React consumers can re-read via
  // useSyncExternalStore. A plugin's `setup` may be async (the external coach
  // awaits before contributing its panels), so contributions can land AFTER the
  // first render — without this, a useMemo([]) snapshot would freeze the tabs as
  // absent for the whole session.
  private version = 0;
  private listeners = new Set<() => void>();

  register(plugin: DataViewerPlugin): void {
    const existing = this.plugins.get(plugin.id);
    if (existing && (plugin.priority ?? 0) <= (existing.priority ?? 0)) return;
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): DataViewerPlugin | undefined {
    return this.plugins.get(id);
  }

  list(): DataViewerPlugin[] {
    return [...this.plugins.values()];
  }

  contribute<T>(point: string, value: T): void {
    const arr = this.contributions.get(point) ?? [];
    arr.push(value);
    this.contributions.set(point, arr);
    this.version++;
    for (const fn of this.listeners) fn();
  }

  getContributions<T>(point: string): T[] {
    return (this.contributions.get(point) ?? []) as T[];
  }

  /** Subscribe to contribution changes (for useSyncExternalStore). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Monotonic counter — the stable snapshot for useSyncExternalStore. */
  getVersion(): number {
    return this.version;
  }
}

const registry = new Registry();
export const pluginRegistry: PluginRegistry = registry;

/** Subscribe to plugin contribution changes (not part of the plugin contract). */
export function subscribeContributions(fn: () => void): () => void {
  return registry.subscribe(fn);
}

/** Current contribution version — changes whenever a plugin contributes. */
export function getContributionsVersion(): number {
  return registry.getVersion();
}
