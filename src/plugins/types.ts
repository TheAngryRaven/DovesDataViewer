// Plugin framework contract.
//
// The open-source app defines these interfaces; plugins (first-party like
// cloud-sync, or private like AI coaching) implement `DataViewerPlugin` and are
// auto-discovered from `src/plugins/<name>/index.ts`. A plugin folder that is
// absent at build time (e.g. the private coaching submodule) simply never
// appears — the app builds and runs without it.

export interface PluginContext {
  /** The shared registry. Plugins read/write extension points through this. */
  registry: PluginRegistry;
}

export interface DataViewerPlugin {
  /** Stable unique id, e.g. "cloud-sync" or "ai-coaching". */
  id: string;
  /** Human-readable name for diagnostics and UI. */
  name: string;
  version?: string;
  /** Called once at startup to wire the plugin into the app. */
  setup?(ctx: PluginContext): void | Promise<void>;
}

export interface PluginRegistry {
  register(plugin: DataViewerPlugin): void;
  get(id: string): DataViewerPlugin | undefined;
  list(): DataViewerPlugin[];
  /**
   * Open-ended extension points: a plugin contributes a value to a named point,
   * and a consumer (drawer tab, file list, etc.) reads everything contributed.
   * Keeping this generic means new extension points need no registry changes.
   */
  contribute<T>(point: string, value: T): void;
  getContributions<T>(point: string): T[];
}
