import { useState, useCallback, useMemo, useEffect } from "react";
import { Pencil, Trash2, NotebookPen, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Note } from "@/lib/noteStorage";
import { Kart } from "@/lib/kartStorage";
import { KartSetup } from "@/lib/setupStorage";

interface NotesTabProps {
  fileName: string | null;
  notes: Note[];
  onAdd: (text: string) => Promise<void>;
  onUpdate: (id: string, text: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  // Session setup link
  karts: Kart[];
  setups: KartSetup[];
  sessionKartId: string | null;
  sessionSetupId: string | null;
  onSaveSessionSetup: (kartId: string | null, setupId: string | null) => Promise<void>;
}

export function NotesTab({
  fileName, notes, onAdd, onUpdate, onRemove,
  karts, setups, sessionKartId, sessionSetupId, onSaveSessionSetup,
}: NotesTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Session setup selection state
  const [selectedKartId, setSelectedKartId] = useState<string | null>(null);
  const [selectedSetupId, setSelectedSetupId] = useState<string | null>(null);

  // Sync selection state when saved values change (e.g. file reloaded)
  useEffect(() => {
    setSelectedKartId(sessionKartId);
    setSelectedSetupId(sessionSetupId);
  }, [sessionKartId, sessionSetupId]);

  // Reset setup when kart changes
  const handleKartChange = useCallback((value: string) => {
    const id = value === "none" ? null : value;
    setSelectedKartId(id);
    setSelectedSetupId(null);
  }, []);

  const handleSetupChange = useCallback((value: string) => {
    setSelectedSetupId(value === "none" ? null : value);
  }, []);

  const filteredSetups = useMemo(() => {
    if (!selectedKartId) return [];
    return setups.filter((s) => s.kartId === selectedKartId);
  }, [setups, selectedKartId]);

  const isSaved = selectedKartId === sessionKartId && selectedSetupId === sessionSetupId;
  const canSave = !isSaved; // allow saving even with nulls to clear selection

  const handleSaveSetup = useCallback(async () => {
    await onSaveSessionSetup(selectedKartId, selectedSetupId);
  }, [selectedKartId, selectedSetupId, onSaveSessionSetup]);

  const resetForm = () => {
    setEditingId(null);
    setText("");
  };

  const handleEdit = (note: Note) => {
    setEditingId(note.id);
    setText(note.text);
  };

  const handleSubmit = useCallback(async () => {
    if (!text.trim()) return;
    if (editingId) {
      await onUpdate(editingId, text.trim());
    } else {
      await onAdd(text.trim());
    }
    resetForm();
  }, [editingId, text, onAdd, onUpdate]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmDelete) return;
    await onRemove(confirmDelete);
    setConfirmDelete(null);
    if (editingId === confirmDelete) resetForm();
  }, [confirmDelete, onRemove, editingId]);

  // No session loaded
  if (!fileName) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2 p-6">
        <NotebookPen className="w-12 h-12 opacity-30" />
        <p className="text-sm">Load a session to add notes</p>
      </div>
    );
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Session Setup Selector */}
      <div className="p-3 space-y-2 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Session Setup</p>
          {isSaved && sessionKartId && (
            <span className="flex items-center gap-1 text-xs text-primary">
              <Check className="w-3 h-3" /> Linked
            </span>
          )}
        </div>
        <Select value={selectedKartId ?? "none"} onValueChange={handleKartChange}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Select kart…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No kart</SelectItem>
            {karts.map((k) => (
              <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={selectedSetupId ?? "none"}
          onValueChange={handleSetupChange}
          disabled={!selectedKartId || filteredSetups.length === 0}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={!selectedKartId ? "Select a kart first" : filteredSetups.length === 0 ? "No setups for this kart" : "Select setup…"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No setup</SelectItem>
            {filteredSetups.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          className="w-full"
          size="sm"
          onClick={handleSaveSetup}
          disabled={!canSave}
        >
          {sessionKartId ? "Update Selection" : "Save Selection"}
        </Button>
      </div>

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="mx-3 mt-3 mb-1 p-3 rounded-md border border-border bg-muted/60 space-y-2 shrink-0">
          <p className="text-sm text-foreground">Delete this note? This cannot be undone.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteConfirm}>Delete</Button>
          </div>
        </div>
      )}

      {/* Notes List */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <NotebookPen className="w-12 h-12 opacity-30" />
            <p className="text-sm">No notes yet</p>
            <p className="text-xs">Add a note using the form below</p>
          </div>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className={`flex items-start gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors ${editingId === note.id ? "ring-1 ring-primary bg-primary/5" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground line-clamp-2">{note.text}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatTime(note.updatedAt)}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100"
                onClick={() => handleEdit(note)}
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100 hover:text-destructive"
                onClick={() => setConfirmDelete(note.id)}
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Form */}
      <div className="border-t border-border p-4 space-y-3 shrink-0">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a note…"
          className="min-h-[60px] text-sm resize-none"
          rows={3}
        />
        <div className="flex items-center gap-2">
          <Button className="flex-1" size="sm" onClick={handleSubmit} disabled={!text.trim()}>
            {editingId ? "Update Note" : "Add Note"}
          </Button>
          {editingId && (
            <Button variant="ghost" size="sm" onClick={resetForm}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
