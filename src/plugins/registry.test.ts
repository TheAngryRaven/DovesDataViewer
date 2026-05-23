import { describe, it, expect, beforeEach } from "vitest";
import type { DataViewerPlugin, PluginRegistry } from "./types";

// Re-instantiate a fresh registry per test by importing the class indirectly.
// The module exposes a singleton, so we test behaviour through it but reset
// state by using unique ids/points per assertion where needed.
import { pluginRegistry } from "./registry";

const makePlugin = (id: string, setup?: DataViewerPlugin["setup"]): DataViewerPlugin => ({
  id,
  name: `Plugin ${id}`,
  setup,
});

describe("pluginRegistry", () => {
  it("registers and retrieves plugins by id", () => {
    const p = makePlugin("alpha");
    pluginRegistry.register(p);
    expect(pluginRegistry.get("alpha")).toBe(p);
    expect(pluginRegistry.list().map((x) => x.id)).toContain("alpha");
  });

  it("ignores duplicate ids", () => {
    const first = makePlugin("dup");
    const second = makePlugin("dup");
    pluginRegistry.register(first);
    pluginRegistry.register(second);
    expect(pluginRegistry.get("dup")).toBe(first);
  });

  it("collects contributions per extension point", () => {
    pluginRegistry.contribute("point:test", "a");
    pluginRegistry.contribute("point:test", "b");
    expect(pluginRegistry.getContributions<string>("point:test")).toEqual(["a", "b"]);
  });

  it("returns an empty array for unknown extension points", () => {
    expect(pluginRegistry.getContributions("point:none")).toEqual([]);
  });

  it("runs a plugin's setup hook with the registry", () => {
    let received: PluginRegistry | null = null;
    const p = makePlugin("with-setup", (ctx) => {
      received = ctx.registry;
    });
    pluginRegistry.register(p);
    void pluginRegistry.get("with-setup")?.setup?.({ registry: pluginRegistry });
    expect(received).toBe(pluginRegistry);
  });
});
