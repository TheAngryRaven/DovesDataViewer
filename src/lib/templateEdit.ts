/**
 * Pure helpers for *editing* an existing vehicle-type template.
 *
 * Setups store their values in `customFields` keyed by the template's
 * `field.id` (never by the display name), so a rename is harmless — the value
 * stays mapped. A field that is **removed** or whose data **type flips**
 * (number ↔ text) would orphan or invalidate values already saved in existing
 * setups; those are the only "destructive" edits we warn about.
 */

import { SetupTemplate, TemplateSection, TemplateFieldDef } from "./templateStorage";

/** A field together with the section it lives in. */
export interface LocatedField {
  field: TemplateFieldDef;
  sectionId: string;
  sectionName: string;
}

/** Map every field id → its definition + owning section. */
export function locateFields(sections: TemplateSection[]): Map<string, LocatedField> {
  const map = new Map<string, LocatedField>();
  for (const section of sections) {
    for (const field of section.fields) {
      map.set(field.id, { field, sectionId: section.id, sectionName: section.name });
    }
  }
  return map;
}

/** Field ids that at least one setup actually holds a (non-empty) value for. */
export function usedFieldIds(
  setups: { templateId: string; customFields: Record<string, string | number | null> }[],
  templateId: string,
): Set<string> {
  const used = new Set<string>();
  for (const setup of setups) {
    if (setup.templateId !== templateId) continue;
    for (const [fieldId, value] of Object.entries(setup.customFields)) {
      if (value !== null && value !== undefined && value !== "") used.add(fieldId);
    }
  }
  return used;
}

export type DestructiveReason = "removed" | "typeChanged";

/** An edit that would discard data existing setups already hold. */
export interface DestructiveChange {
  /** The ORIGINAL field definition (what we'd restore on cancel). */
  field: TemplateFieldDef;
  sectionId: string;
  sectionName: string;
  reason: DestructiveReason;
}

/**
 * Compare an edited template's sections against the original, restricted to
 * fields existing setups actually use. A rename is never destructive (setups
 * key on `field.id`); a removal or a type flip is.
 */
export function findDestructiveChanges(
  original: TemplateSection[],
  edited: TemplateSection[],
  used: Set<string>,
): DestructiveChange[] {
  const editedFields = locateFields(edited);
  const changes: DestructiveChange[] = [];
  for (const { field, sectionId, sectionName } of locateFields(original).values()) {
    if (!used.has(field.id)) continue;
    const stillThere = editedFields.get(field.id);
    if (!stillThere) {
      changes.push({ field, sectionId, sectionName, reason: "removed" });
    } else if (stillThere.field.type !== field.type) {
      changes.push({ field, sectionId, sectionName, reason: "typeChanged" });
    }
  }
  return changes;
}

/**
 * Roll the destructive edits back to their original definitions: re-insert a
 * removed field into its original section (recreating that section if it too
 * was removed) and reset a flipped field's type. Benign edits (renames, added
 * fields, reordering, wheel/tire changes) are left untouched. Returns the
 * patched sections plus the set of restored field ids (for the orange
 * highlight).
 */
export function revertDestructive(
  original: TemplateSection[],
  edited: TemplateSection[],
  destructive: DestructiveChange[],
): { sections: TemplateSection[]; restoredIds: Set<string> } {
  const restoredIds = new Set<string>();
  // Deep-ish clone so callers can drop the result straight into state.
  const sections: TemplateSection[] = edited.map((s) => ({
    ...s,
    fields: s.fields.map((f) => ({ ...f })),
  }));
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  for (const change of destructive) {
    restoredIds.add(change.field.id);
    if (change.reason === "typeChanged") {
      const target = sectionById.get(change.sectionId)?.fields.find((f) => f.id === change.field.id)
        ?? sections.flatMap((s) => s.fields).find((f) => f.id === change.field.id);
      if (target) target.type = change.field.type;
      continue;
    }
    // Removed: ensure the original section exists, then re-add the field.
    let section = sectionById.get(change.sectionId);
    if (!section) {
      section = { id: change.sectionId, name: change.sectionName, fields: [] };
      sectionById.set(section.id, section);
      sections.push(section);
    }
    if (!section.fields.some((f) => f.id === change.field.id)) {
      section.fields.push({ ...change.field });
    }
  }

  return { sections, restoredIds };
}

/** Drop blank sections/fields and trim names — shared by create + edit save. */
export function cleanSections(sections: TemplateSection[]): TemplateSection[] {
  return sections
    .filter((s) => s.name.trim())
    .map((s) => ({
      ...s,
      name: s.name.trim(),
      fields: s.fields.filter((f) => f.name.trim()).map((f) => ({ ...f, name: f.name.trim() })),
    }))
    .filter((s) => s.fields.length > 0);
}

/** Build the next vehicle-type + template records for an in-place edit. */
export function buildTemplateUpdate<V extends { id: string; name: string; templateId: string; wheelCount?: 2 | 4 }>(
  vehicleType: V,
  template: SetupTemplate,
  edits: { name: string; wheelCount: 2 | 4; includeTires: boolean; sections: TemplateSection[] },
): { vehicleType: V; template: SetupTemplate } {
  return {
    // Keep the vehicle type's own wheelCount mirror in sync with the template.
    vehicleType: { ...vehicleType, name: edits.name, wheelCount: edits.wheelCount },
    template: {
      ...template,
      name: edits.name,
      wheelCount: edits.wheelCount,
      includeTires: edits.includeTires,
      sections: edits.sections,
    },
  };
}
