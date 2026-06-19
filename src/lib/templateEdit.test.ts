import { describe, it, expect } from "vitest";
import {
  usedFieldIds, findDestructiveChanges, revertDestructive,
  cleanSections, buildTemplateUpdate, locateFields,
} from "./templateEdit";
import { SetupTemplate, TemplateSection } from "./templateStorage";

const original: TemplateSection[] = [
  {
    id: "secA", name: "Alignment", fields: [
      { id: "f-toe", name: "Toe", type: "number" },
      { id: "f-camber", name: "Camber", type: "number" },
    ],
  },
  {
    id: "secB", name: "Notes", fields: [
      { id: "f-note", name: "Note", type: "string" },
    ],
  },
];

const setups: { templateId: string; customFields: Record<string, string | number | null> }[] = [
  { templateId: "tpl1", customFields: { "f-toe": 2, "f-camber": null, "f-note": "soft" } },
  { templateId: "tpl1", customFields: { "f-toe": 3 } },
  { templateId: "other", customFields: { "f-toe": 99 } },
];

describe("usedFieldIds", () => {
  it("collects only fields with non-empty values for the given template", () => {
    const used = usedFieldIds(setups, "tpl1");
    expect(used.has("f-toe")).toBe(true);   // has values
    expect(used.has("f-note")).toBe(true);  // "soft"
    expect(used.has("f-camber")).toBe(false); // only null
  });

  it("ignores setups belonging to other templates", () => {
    const used = usedFieldIds([{ templateId: "other", customFields: { "f-x": 1 } }], "tpl1");
    expect(used.size).toBe(0);
  });
});

describe("findDestructiveChanges", () => {
  const used = new Set(["f-toe", "f-note"]);

  it("treats a rename as non-destructive (setups key on id, not name)", () => {
    const edited: TemplateSection[] = [
      { id: "secA", name: "Alignment", fields: [
        { id: "f-toe", name: "Front Toe", type: "number" },
        { id: "f-camber", name: "Camber", type: "number" },
      ] },
      { id: "secB", name: "Notes", fields: [{ id: "f-note", name: "Note", type: "string" }] },
    ];
    expect(findDestructiveChanges(original, edited, used)).toEqual([]);
  });

  it("flags a removed in-use field", () => {
    const edited: TemplateSection[] = [
      { id: "secA", name: "Alignment", fields: [{ id: "f-camber", name: "Camber", type: "number" }] },
      { id: "secB", name: "Notes", fields: [{ id: "f-note", name: "Note", type: "string" }] },
    ];
    const changes = findDestructiveChanges(original, edited, used);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: { id: "f-toe" }, reason: "removed", sectionId: "secA" });
  });

  it("flags a type flip on an in-use field", () => {
    const edited: TemplateSection[] = [
      { id: "secA", name: "Alignment", fields: [
        { id: "f-toe", name: "Toe", type: "string" },
        { id: "f-camber", name: "Camber", type: "number" },
      ] },
      { id: "secB", name: "Notes", fields: [{ id: "f-note", name: "Note", type: "string" }] },
    ];
    const changes = findDestructiveChanges(original, edited, used);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: { id: "f-toe" }, reason: "typeChanged" });
  });

  it("does not flag removal/retype of a field no setup uses", () => {
    const edited: TemplateSection[] = [
      { id: "secA", name: "Alignment", fields: [{ id: "f-toe", name: "Toe", type: "number" }] },
      { id: "secB", name: "Notes", fields: [{ id: "f-note", name: "Note", type: "string" }] },
    ];
    // f-camber removed but it's unused → not destructive
    expect(findDestructiveChanges(original, edited, used)).toEqual([]);
  });
});

describe("revertDestructive", () => {
  const used = new Set(["f-toe", "f-note"]);

  it("re-adds a removed field to its original section and marks it restored", () => {
    const edited: TemplateSection[] = [
      { id: "secA", name: "Alignment", fields: [{ id: "f-camber", name: "Camber", type: "number" }] },
      { id: "secB", name: "Notes", fields: [{ id: "f-note", name: "Note", type: "string" }] },
    ];
    const changes = findDestructiveChanges(original, edited, used);
    const { sections, restoredIds } = revertDestructive(original, edited, changes);
    expect(restoredIds.has("f-toe")).toBe(true);
    expect(locateFields(sections).get("f-toe")).toMatchObject({ sectionId: "secA", field: { name: "Toe", type: "number" } });
  });

  it("recreates a section that was deleted along with its in-use field", () => {
    const edited: TemplateSection[] = [
      { id: "secA", name: "Alignment", fields: [
        { id: "f-toe", name: "Toe", type: "number" },
        { id: "f-camber", name: "Camber", type: "number" },
      ] },
      // secB (with f-note) removed entirely
    ];
    const changes = findDestructiveChanges(original, edited, used);
    const { sections, restoredIds } = revertDestructive(original, edited, changes);
    expect(restoredIds.has("f-note")).toBe(true);
    const located = locateFields(sections).get("f-note");
    expect(located).toMatchObject({ sectionId: "secB", sectionName: "Notes" });
  });

  it("resets a flipped field's type back to the original", () => {
    const edited: TemplateSection[] = [
      { id: "secA", name: "Alignment", fields: [
        { id: "f-toe", name: "Toe", type: "string" },
        { id: "f-camber", name: "Camber", type: "number" },
      ] },
      { id: "secB", name: "Notes", fields: [{ id: "f-note", name: "Note", type: "string" }] },
    ];
    const changes = findDestructiveChanges(original, edited, used);
    const { sections, restoredIds } = revertDestructive(original, edited, changes);
    expect(restoredIds.has("f-toe")).toBe(true);
    expect(locateFields(sections).get("f-toe")!.field.type).toBe("number");
  });

  it("keeps benign edits (a rename) untouched while reverting the bad field", () => {
    const edited: TemplateSection[] = [
      { id: "secA", name: "Suspension", fields: [ // section renamed (benign)
        { id: "f-camber", name: "Camber Angle", type: "number" }, // field renamed (benign)
      ] },
      { id: "secB", name: "Notes", fields: [{ id: "f-note", name: "Note", type: "string" }] },
    ];
    const changes = findDestructiveChanges(original, edited, used); // f-toe removed
    const { sections } = revertDestructive(original, edited, changes);
    const located = locateFields(sections);
    expect(located.get("f-camber")!.field.name).toBe("Camber Angle"); // rename kept
    expect(located.get("f-toe")).toBeTruthy(); // restored
  });
});

describe("cleanSections", () => {
  it("drops blank sections and fields and trims names", () => {
    const messy: TemplateSection[] = [
      { id: "s1", name: "  Real  ", fields: [
        { id: "a", name: " Keep ", type: "number" },
        { id: "b", name: "   ", type: "number" },
      ] },
      { id: "s2", name: "   ", fields: [{ id: "c", name: "Gone", type: "number" }] },
      { id: "s3", name: "Empty", fields: [{ id: "d", name: "", type: "number" }] },
    ];
    const out = cleanSections(messy);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Real");
    expect(out[0].fields).toEqual([{ id: "a", name: "Keep", type: "number" }]);
  });
});

describe("buildTemplateUpdate", () => {
  it("carries the new name into both records and replaces template fields", () => {
    const vt = { id: "vt1", name: "Old", templateId: "tpl1" };
    const tpl: SetupTemplate = {
      id: "tpl1", vehicleTypeId: "vt1", name: "Old", sections: original,
      wheelCount: 4, includeTires: true, isDefault: false, createdAt: 1, updatedAt: 1,
    };
    const next: TemplateSection[] = [{ id: "secA", name: "A", fields: [{ id: "f-toe", name: "Toe", type: "number" }] }];
    const { vehicleType, template } = buildTemplateUpdate(vt, tpl, { name: "New", wheelCount: 2, includeTires: false, sections: next });
    expect(vehicleType.name).toBe("New");
    expect(template.name).toBe("New");
    expect(template.wheelCount).toBe(2);
    expect(template.includeTires).toBe(false);
    expect(template.sections).toBe(next);
    expect(template.id).toBe("tpl1"); // identity preserved
  });
});
