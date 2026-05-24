import { describe, it, expect } from "vitest";
import { pluginRegistry } from "./registry";
import { PANELS_POINT, PanelSlot, getPanelsForSlot, isBareSlot, type PluginPanel } from "./panels";

const noopComponent: PluginPanel["component"] = () => null;

function panel(id: string, slot: string, order?: number): PluginPanel {
  return { id, title: id, slot, order, component: noopComponent };
}

function chromelessPanel(id: string, slot: string): PluginPanel {
  return { id, title: id, slot, chromeless: true, component: noopComponent };
}

describe("getPanelsForSlot", () => {
  it("returns only panels contributed to the requested slot", () => {
    pluginRegistry.contribute(PANELS_POINT, panel("a", "slot-filter"));
    pluginRegistry.contribute(PANELS_POINT, panel("b", "slot-other"));

    expect(getPanelsForSlot("slot-filter").map((p) => p.id)).toEqual(["a"]);
  });

  it("sorts by order ascending, treating missing order as 0", () => {
    pluginRegistry.contribute(PANELS_POINT, panel("late", "slot-order", 10));
    pluginRegistry.contribute(PANELS_POINT, panel("default", "slot-order"));
    pluginRegistry.contribute(PANELS_POINT, panel("early", "slot-order", -5));

    expect(getPanelsForSlot("slot-order").map((p) => p.id)).toEqual([
      "early",
      "default",
      "late",
    ]);
  });

  it("returns an empty array for a slot with no contributions", () => {
    expect(getPanelsForSlot("slot-empty")).toEqual([]);
  });

  it("keeps the Coach and Labs slots separate", () => {
    pluginRegistry.contribute(PANELS_POINT, panel("coach-panel", PanelSlot.Coach));
    pluginRegistry.contribute(PANELS_POINT, panel("labs-panel", PanelSlot.Labs));

    expect(getPanelsForSlot(PanelSlot.Coach).map((p) => p.id)).toEqual(["coach-panel"]);
    expect(getPanelsForSlot(PanelSlot.Labs).map((p) => p.id)).toEqual(["labs-panel"]);
  });
});

describe("isBareSlot", () => {
  it("is true only when there are panels and all are chromeless", () => {
    expect(isBareSlot([chromelessPanel("a", "s"), chromelessPanel("b", "s")])).toBe(true);
  });

  it("is false for an empty slot", () => {
    expect(isBareSlot([])).toBe(false);
  });

  it("is false when any panel keeps its chrome", () => {
    expect(isBareSlot([chromelessPanel("a", "s"), panel("b", "s")])).toBe(false);
  });
});
