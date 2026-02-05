import { useState, useCallback } from "react";
import { Pencil, Trash2, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Note } from "@/lib/noteStorage";

interface NotesTabProps {
  fileName: string | null;
  notes: Note[];
  onAdd: (text: string) => Promise<void>;
  onUpdate: (id: string, text: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

export function NotesTab({ fileName, notes, onAdd, onUpdate, onRemove }: NotesTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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
