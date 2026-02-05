import { useState, useEffect, useCallback } from "react";
import { Note, listNotes, saveNote, deleteNote } from "@/lib/noteStorage";

export function useNoteManager(fileName: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);

  const refresh = useCallback(async () => {
    if (!fileName) {
      setNotes([]);
      return;
    }
    const result = await listNotes(fileName);
    setNotes(result);
  }, [fileName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addNote = useCallback(
    async (text: string) => {
      if (!fileName) return;
      const now = Date.now();
      const note: Note = {
        id: crypto.randomUUID(),
        fileName,
        text,
        createdAt: now,
        updatedAt: now,
      };
      await saveNote(note);
      await refresh();
    },
    [fileName, refresh]
  );

  const updateNote = useCallback(
    async (id: string, text: string) => {
      const existing = notes.find((n) => n.id === id);
      if (!existing) return;
      await saveNote({ ...existing, text, updatedAt: Date.now() });
      await refresh();
    },
    [notes, refresh]
  );

  const removeNote = useCallback(
    async (id: string) => {
      await deleteNote(id);
      await refresh();
    },
    [refresh]
  );

  return { notes, addNote, updateNote, removeNote };
}
