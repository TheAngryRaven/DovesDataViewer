/**
 * IndexedDB tests for templateStorage — the vehicle-types + setup-templates
 * stores. Covers default seeding (idempotent), the atomic
 * create/delete-vehicle-type-with-template pair, plain CRUD, and garage events.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import {
  ensureDefaults,
  listVehicleTypes,
  getVehicleType,
  saveVehicleType,
  deleteVehicleType,
  listTemplates,
  getTemplate,
  saveTemplate,
  createVehicleTypeWithTemplate,
  deleteVehicleTypeWithTemplate,
  DEFAULT_KART_VEHICLE_TYPE_ID,
  DEFAULT_KART_TEMPLATE_ID,
  type TemplateSection,
} from "./templateStorage";
import { onGarageChange } from "./garageEvents";

beforeEach(() => freshIndexedDB());

const sections: TemplateSection[] = [
  { id: "sec1", name: "Alignment", fields: [{ id: "f-toe", name: "Toe", type: "number" }] },
];

describe("ensureDefaults", () => {
  it("seeds the default kart vehicle type + template on first run", async () => {
    await ensureDefaults();
    expect(await getVehicleType(DEFAULT_KART_VEHICLE_TYPE_ID)).not.toBeNull();
    expect(await getTemplate(DEFAULT_KART_TEMPLATE_ID)).not.toBeNull();
  });

  it("is idempotent — a second run doesn't duplicate the defaults", async () => {
    await ensureDefaults();
    await ensureDefaults();
    expect(await listVehicleTypes()).toHaveLength(1);
    expect(await listTemplates()).toHaveLength(1);
  });
});

describe("vehicle-type + template CRUD", () => {
  it("saves and reads a vehicle type and a template", async () => {
    await saveVehicleType({
      id: "vt1",
      name: "Shifter",
      templateId: "tpl1",
      wheelCount: 4,
      isDefault: false,
      createdAt: 1,
    });
    await saveTemplate({
      id: "tpl1",
      vehicleTypeId: "vt1",
      name: "Shifter",
      sections,
      wheelCount: 4,
      includeTires: true,
      isDefault: false,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await getVehicleType("vt1")).toMatchObject({ name: "Shifter" });
    expect(await getTemplate("tpl1")).toMatchObject({ vehicleTypeId: "vt1" });
  });

  it("emits garage events on vehicle-type save/delete", async () => {
    const seen = vi.fn();
    const off = onGarageChange(seen);
    await saveVehicleType({ id: "vt1", name: "X", templateId: "t", wheelCount: 2, isDefault: false, createdAt: 1 });
    await deleteVehicleType("vt1");
    off();
    expect(seen).toHaveBeenNthCalledWith(1, { store: "vehicle-types", key: "vt1", type: "put" });
    expect(seen).toHaveBeenNthCalledWith(2, { store: "vehicle-types", key: "vt1", type: "delete" });
  });
});

describe("createVehicleTypeWithTemplate / deleteVehicleTypeWithTemplate", () => {
  it("creates a linked vehicle type + template atomically", async () => {
    const { vehicleType, template } = await createVehicleTypeWithTemplate("Superkart", 4, true, sections);
    expect(vehicleType.templateId).toBe(template.id);
    expect(template.vehicleTypeId).toBe(vehicleType.id);
    expect(await getVehicleType(vehicleType.id)).not.toBeNull();
    expect(await getTemplate(template.id)).not.toBeNull();
  });

  it("deletes both halves of the pair", async () => {
    const { vehicleType, template } = await createVehicleTypeWithTemplate("Superkart", 4, true, sections);
    await deleteVehicleTypeWithTemplate(vehicleType.id, template.id);
    expect(await getVehicleType(vehicleType.id)).toBeNull();
    expect(await getTemplate(template.id)).toBeNull();
  });

  it("emits a put for both stores on create", async () => {
    const seen = vi.fn();
    const off = onGarageChange(seen);
    const { vehicleType, template } = await createVehicleTypeWithTemplate("S", 2, false, sections);
    off();
    expect(seen).toHaveBeenCalledWith({ store: "vehicle-types", key: vehicleType.id, type: "put" });
    expect(seen).toHaveBeenCalledWith({ store: "setup-templates", key: template.id, type: "put" });
  });
});
