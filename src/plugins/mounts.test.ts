import { describe, it, expect } from "vitest";
import { pluginRegistry } from "./registry";
import { MOUNTS_POINT, getMounts, type PluginMountDef } from "./mounts";

const noop: PluginMountDef["component"] = () => null;

function mount(id: string, slot: string, order?: number): PluginMountDef {
  return { id, slot, order, component: noop };
}

describe("getMounts", () => {
  it("returns only mounts contributed to the requested slot", () => {
    pluginRegistry.contribute(MOUNTS_POINT, mount("a", "slot-x"));
    pluginRegistry.contribute(MOUNTS_POINT, mount("b", "slot-y"));
    expect(getMounts("slot-x").map((m) => m.id)).toEqual(["a"]);
  });

  it("sorts by order ascending, missing order treated as 0", () => {
    pluginRegistry.contribute(MOUNTS_POINT, mount("late", "slot-ord", 5));
    pluginRegistry.contribute(MOUNTS_POINT, mount("mid", "slot-ord"));
    pluginRegistry.contribute(MOUNTS_POINT, mount("early", "slot-ord", -1));
    expect(getMounts("slot-ord").map((m) => m.id)).toEqual(["early", "mid", "late"]);
  });

  it("returns an empty array for a slot with no mounts", () => {
    expect(getMounts("slot-empty")).toEqual([]);
  });
});
