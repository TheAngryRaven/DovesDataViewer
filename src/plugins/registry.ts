import type { DataViewerPlugin, PluginRegistry } from "./types";

class Registry implements PluginRegistry {
  private plugins = new Map<string, DataViewerPlugin>();
  private contributions = new Map<string, unknown[]>();

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
  }

  getContributions<T>(point: string): T[] {
    return (this.contributions.get(point) ?? []) as T[];
  }
}

export const pluginRegistry: PluginRegistry = new Registry();
