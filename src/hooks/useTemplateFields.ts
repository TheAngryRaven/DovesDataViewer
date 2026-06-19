import { useState, useCallback } from "react";
import { SetupTemplate, TemplateSection, TemplateFieldDef } from "@/lib/templateStorage";

const makeId = () => crypto.randomUUID();

export const emptyField = (): TemplateFieldDef => ({ id: makeId(), name: "", type: "number" });
export const emptySection = (): TemplateSection => ({ id: makeId(), name: "", fields: [emptyField()] });

/**
 * Draft state + mutators for the section/field editor, shared by the
 * vehicle-type creator and editor. Owns name, wheel config, tires and the
 * section list so both screens stay thin wrappers around one source of truth.
 */
export function useTemplateFields() {
  const [name, setName] = useState("");
  const [wheelCount, setWheelCount] = useState<2 | 4>(4);
  const [includeTires, setIncludeTires] = useState(true);
  const [sections, setSections] = useState<TemplateSection[]>([emptySection()]);

  const addSection = useCallback(() => setSections(prev => [...prev, emptySection()]), []);

  const removeSection = useCallback((secId: string) => {
    setSections(prev => prev.filter(s => s.id !== secId));
  }, []);

  const updateSection = useCallback((secId: string, update: Partial<TemplateSection>) => {
    setSections(prev => prev.map(s => s.id === secId ? { ...s, ...update } : s));
  }, []);

  const addField = useCallback((secId: string) => {
    setSections(prev => prev.map(s =>
      s.id === secId ? { ...s, fields: [...s.fields, emptyField()] } : s
    ));
  }, []);

  const removeField = useCallback((secId: string, fieldId: string) => {
    setSections(prev => prev.map(s =>
      s.id === secId ? { ...s, fields: s.fields.filter(f => f.id !== fieldId) } : s
    ));
  }, []);

  const updateField = useCallback((secId: string, fieldId: string, update: Partial<TemplateFieldDef>) => {
    setSections(prev => prev.map(s =>
      s.id === secId ? {
        ...s,
        fields: s.fields.map(f => f.id === fieldId ? { ...f, ...update } : f),
      } : s
    ));
  }, []);

  /**
   * Load a template's structure into the draft. `cloneIds` mints fresh ids
   * (copy-from-scratch, so the new type is independent); leaving it false
   * preserves `field.id`s so an in-place edit keeps existing setups mapped.
   * Does not touch `name` — the caller decides.
   */
  const loadSections = useCallback((tpl: SetupTemplate, opts: { cloneIds: boolean }) => {
    setSections(tpl.sections.map(s => ({
      id: opts.cloneIds ? makeId() : s.id,
      name: s.name,
      fields: s.fields.map(f => opts.cloneIds ? { ...f, id: makeId() } : { ...f }),
    })));
    setWheelCount(tpl.wheelCount);
    setIncludeTires(tpl.includeTires);
  }, []);

  const reset = useCallback(() => {
    setName("");
    setWheelCount(4);
    setIncludeTires(true);
    setSections([emptySection()]);
  }, []);

  return {
    name, setName, wheelCount, setWheelCount, includeTires, setIncludeTires,
    sections, setSections, addSection, removeSection, updateSection,
    addField, removeField, updateField, loadSections, reset,
  };
}

export type TemplateFieldsState = ReturnType<typeof useTemplateFields>;
