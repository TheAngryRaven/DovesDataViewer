import { useState, useCallback } from "react";
import { ArrowLeft, Plus, Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui/number-input";
import { SetupTemplate, TemplateSection, TemplateFieldDef } from "@/lib/templateStorage";

interface TemplateCreatorProps {
  existingTemplates: SetupTemplate[];
  existingTypeNames: string[];
  onSave: (name: string, wheelCount: 2 | 4, includeTires: boolean, sections: TemplateSection[]) => Promise<void>;
  onCancel: () => void;
}

const makeId = () => crypto.randomUUID();

const emptyField = (): TemplateFieldDef => ({
  id: makeId(),
  name: "",
  type: "number",
});

const emptySection = (): TemplateSection => ({
  id: makeId(),
  name: "",
  fields: [emptyField()],
});

export function TemplateCreator({ existingTemplates, existingTypeNames, onSave, onCancel }: TemplateCreatorProps) {
  const [name, setName] = useState("");
  const [wheelCount, setWheelCount] = useState<2 | 4>(4);
  const [includeTires, setIncludeTires] = useState(true);
  const [sections, setSections] = useState<TemplateSection[]>([emptySection()]);
  const [copyFrom, setCopyFrom] = useState<string>("");
  const [nameError, setNameError] = useState("");

  const handleCopyFrom = useCallback((templateId: string) => {
    setCopyFrom(templateId);
    const tpl = existingTemplates.find(t => t.id === templateId);
    if (tpl) {
      // Deep clone sections with new IDs
      const cloned = tpl.sections.map(s => ({
        id: makeId(),
        name: s.name,
        fields: s.fields.map(f => ({ ...f, id: makeId() })),
      }));
      setSections(cloned);
      setWheelCount(tpl.wheelCount);
      setIncludeTires(tpl.includeTires);
    }
  }, [existingTemplates]);

  const addSection = useCallback(() => {
    setSections(prev => [...prev, emptySection()]);
  }, []);

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

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) { setNameError("Name is required"); return; }
    if (existingTypeNames.some(n => n.toLowerCase() === trimmed.toLowerCase())) {
      setNameError("A vehicle type with this name already exists");
      return;
    }
    // Filter out empty sections/fields
    const cleaned = sections
      .filter(s => s.name.trim())
      .map(s => ({
        ...s,
        name: s.name.trim(),
        fields: s.fields.filter(f => f.name.trim()).map(f => ({ ...f, name: f.name.trim() })),
      }))
      .filter(s => s.fields.length > 0);

    await onSave(trimmed, wheelCount, includeTires, cleaned);
  }, [name, wheelCount, includeTires, sections, existingTypeNames, onSave]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h3 className="text-sm font-semibold text-foreground flex-1">New Vehicle Type</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Name */}
        <div className="space-y-1">
          <Label className="text-xs">Vehicle Type Name</Label>
          <Input
            value={name}
            onChange={e => { setName(e.target.value); setNameError(""); }}
            placeholder="e.g. Sprint Car, MX Bike"
            className={`h-9 ${nameError ? "border-destructive" : ""}`}
          />
          {nameError && <p className="text-xs text-destructive">{nameError}</p>}
        </div>

        {/* Copy from */}
        <div className="space-y-1">
          <Label className="text-xs">Copy from existing (optional)</Label>
          <Select value={copyFrom} onValueChange={handleCopyFrom}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Start from scratch" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Start from scratch</SelectItem>
              {existingTemplates.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Wheel count */}
        <div className="space-y-1">
          <Label className="text-xs">Wheel Configuration</Label>
          <div className="flex gap-1 bg-muted/50 rounded-md p-0.5">
            <button type="button" onClick={() => setWheelCount(2)} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${wheelCount === 2 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>2 Wheels</button>
            <button type="button" onClick={() => setWheelCount(4)} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${wheelCount === 4 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>4 Wheels</button>
          </div>
        </div>

        {/* Include tires */}
        <div className="flex items-center justify-between">
          <Label className="text-xs">Include tire management</Label>
          <Switch checked={includeTires} onCheckedChange={setIncludeTires} className="scale-90" />
        </div>

        {/* Sections */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Setup Sections</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {sections.map((section, si) => (
            <div key={section.id} className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
              <div className="flex items-center gap-2">
                <Input
                  value={section.name}
                  onChange={e => updateSection(section.id, { name: e.target.value })}
                  placeholder="Section name (e.g. Alignment)"
                  className="h-8 text-sm flex-1"
                />
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive shrink-0" onClick={() => removeSection(section.id)} disabled={sections.length <= 1}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>

              {section.fields.map((field, fi) => (
                <div key={field.id} className="flex items-start gap-2 pl-2 border-l-2 border-border">
                  <div className="flex-1 space-y-1">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={field.name}
                        onChange={e => updateField(section.id, field.id, { name: e.target.value })}
                        placeholder="Field name"
                        className="h-8 text-sm"
                      />
                      <Select
                        value={field.type}
                        onValueChange={v => updateField(section.id, field.id, { type: v as "number" | "string" })}
                      >
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="number">Number</SelectItem>
                          <SelectItem value="string">Text</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-0.5">
                        <Label className="text-[10px] text-muted-foreground">Unit</Label>
                        <Input
                          value={field.unit ?? ""}
                          onChange={e => updateField(section.id, field.id, { unit: e.target.value || undefined })}
                          placeholder="e.g. psi"
                          className="h-7 text-xs"
                        />
                      </div>
                      {field.type === "number" && (
                        <>
                          <div className="space-y-0.5">
                            <Label className="text-[10px] text-muted-foreground">Min</Label>
                            <Input
                              type="number"
                              value={field.min ?? ""}
                              onChange={e => updateField(section.id, field.id, { min: e.target.value === "" ? undefined : Number(e.target.value) })}
                              className="h-7 text-xs"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px] text-muted-foreground">Max</Label>
                            <Input
                              type="number"
                              value={field.max ?? ""}
                              onChange={e => updateField(section.id, field.id, { max: e.target.value === "" ? undefined : Number(e.target.value) })}
                              className="h-7 text-xs"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive shrink-0 mt-0.5" onClick={() => removeField(section.id, field.id)} disabled={section.fields.length <= 1}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}

              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => addField(section.id)}>
                <Plus className="w-3 h-3" /> Add Field
              </Button>
            </div>
          ))}

          <Button variant="outline" size="sm" className="w-full gap-1" onClick={addSection}>
            <Plus className="w-3.5 h-3.5" /> Add Section
          </Button>
        </div>
      </div>

      <div className="shrink-0 px-3 py-3 border-t border-border flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button className="flex-1" onClick={handleSave} disabled={!name.trim()}>Create</Button>
      </div>
    </div>
  );
}
