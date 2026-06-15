import { useState, useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2, NotebookPen, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Note, MAX_NOTE_BYTES } from "@/lib/noteStorage";
import { Vehicle } from "@/lib/vehicleStorage";
import { VehicleSetup } from "@/lib/setupStorage";
import { shortRevHash } from "@/lib/setupRevision";

interface NotesTabProps {
  fileName: string | null;
  notes: Note[];
  onAdd: (text: string) => Promise<void>;
  onUpdate: (id: string, text: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  vehicles: Vehicle[];
  setups: VehicleSetup[];
  sessionKartId: string | null;
  sessionSetupId: string | null;
  /** Content hash of the frozen setup revision this session ran (immutable id). */
  sessionSetupRev: string | null;
  onSaveSessionSetup: (kartId: string | null, setupId: string | null) => Promise<void>;
}

export function NotesTab({
  fileName, notes, onAdd, onUpdate, onRemove,
  vehicles, setups, sessionKartId, sessionSetupId, sessionSetupRev, onSaveSessionSetup,
}: NotesTabProps) {
  const { t } = useTranslation("drawer");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedSetupId, setSelectedSetupId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedVehicleId(sessionKartId);
    setSelectedSetupId(sessionSetupId);
  }, [sessionKartId, sessionSetupId]);

  const handleVehicleChange = useCallback((value: string) => {
    const id = value === "none" ? null : value;
    setSelectedVehicleId(id);
    setSelectedSetupId(null);
  }, []);

  const handleSetupChange = useCallback((value: string) => {
    setSelectedSetupId(value === "none" ? null : value);
  }, []);

  const filteredSetups = useMemo(() => {
    if (!selectedVehicleId) return [];
    return setups.filter(s => s.vehicleId === selectedVehicleId);
  }, [setups, selectedVehicleId]);

  const isSaved = selectedVehicleId === sessionKartId && selectedSetupId === sessionSetupId;
  const canSave = !isSaved;

  const handleSaveSetup = useCallback(async () => {
    await onSaveSessionSetup(selectedVehicleId, selectedSetupId);
  }, [selectedVehicleId, selectedSetupId, onSaveSessionSetup]);

  const resetForm = () => { setEditingId(null); setText(""); };

  const handleEdit = (note: Note) => { setEditingId(note.id); setText(note.text); };

  const handleSubmit = useCallback(async () => {
    if (!text.trim()) return;
    if (editingId) { await onUpdate(editingId, text.trim()); }
    else { await onAdd(text.trim()); }
    resetForm();
  }, [editingId, text, onAdd, onUpdate]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmDelete) return;
    await onRemove(confirmDelete);
    setConfirmDelete(null);
    if (editingId === confirmDelete) resetForm();
  }, [confirmDelete, onRemove, editingId]);

  if (!fileName) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2 p-6">
        <NotebookPen className="w-12 h-12 opacity-30" />
        <p className="text-sm">{t("notes.loadSession")}</p>
      </div>
    );
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Session Setup Selector */}
      <div className="p-3 space-y-2 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("notes.sessionSetup")}</p>
          {isSaved && sessionKartId && (
            <span className="flex items-center gap-1 text-xs text-primary"><Check className="w-3 h-3" /> {t("notes.linked")}</span>
          )}
        </div>
        <Select value={selectedVehicleId ?? "none"} onValueChange={handleVehicleChange}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("notes.selectVehicle")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("notes.noVehicle")}</SelectItem>
            {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={selectedSetupId ?? "none"} onValueChange={handleSetupChange} disabled={!selectedVehicleId || filteredSetups.length === 0}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={!selectedVehicleId ? t("notes.selectVehicleFirst") : filteredSetups.length === 0 ? t("notes.noSetupsForVehicle") : t("notes.selectSetup")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("notes.noSetup")}</SelectItem>
            {filteredSetups.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button className="w-full" size="sm" onClick={handleSaveSetup} disabled={!canSave}>
          {sessionKartId ? t("notes.updateSelection") : t("notes.saveSelection")}
        </Button>
        {!sessionSetupId && (
          <p className="text-xs text-orange-500">
            {t("notes.setupWarning")}
          </p>
        )}
        {isSaved && sessionSetupRev && (
          <p className="text-xs text-muted-foreground">
            {t("notes.setupRevision")}{" "}
            <span className="font-mono text-foreground" title={sessionSetupRev}>
              #{shortRevHash(sessionSetupRev)}
            </span>{" "}
            {t("notes.setupFrozen")}
          </p>
        )}
      </div>

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="mx-3 mt-3 mb-1 p-3 rounded-md border border-border bg-muted/60 space-y-2 shrink-0">
          <p className="text-sm text-foreground">{t("notes.deleteConfirm")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>{t("notes.cancel")}</Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteConfirm}>{t("notes.delete")}</Button>
          </div>
        </div>
      )}

      {/* Notes List */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <NotebookPen className="w-12 h-12 opacity-30" />
            <p className="text-sm">{t("notes.emptyTitle")}</p>
            <p className="text-xs">{t("notes.emptyHint")}</p>
          </div>
        ) : (
          notes.map(note => (
            <div key={note.id} className={`flex items-start gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors ${editingId === note.id ? "ring-1 ring-primary bg-primary/5" : ""}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground line-clamp-2">{note.text}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatTime(note.updatedAt)}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100" onClick={() => handleEdit(note)} title={t("notes.edit")}><Pencil className="w-3.5 h-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100 hover:text-destructive" onClick={() => setConfirmDelete(note.id)} title={t("notes.delete")}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Form */}
      <div className="border-t border-border p-4 space-y-3 shrink-0">
        <Textarea value={text} onChange={e => setText(e.target.value)} placeholder={t("notes.writeNote")} className="min-h-[60px] text-sm resize-none" rows={3} maxLength={MAX_NOTE_BYTES} />
        <div className="flex items-center gap-2">
          <Button className="flex-1" size="sm" onClick={handleSubmit} disabled={!text.trim()}>
            {editingId ? t("notes.updateNote") : t("notes.addNote")}
          </Button>
          {editingId && <Button variant="ghost" size="sm" onClick={resetForm}>{t("notes.cancel")}</Button>}
        </div>
      </div>
    </div>
  );
}
