import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  getFileLoading,
  subscribeFileLoading,
  type FileLoadingState,
} from "@/lib/fileLoadingState";

/**
 * Full-screen dimmer + spinner shown while a datalog file is being loaded.
 * Driven by the `fileLoadingState` pub/sub (bracketed around every session load
 * in `parseDatalogFile`), so it's automatic for imports, file-manager reopens,
 * and cloud-file opens alike. Most loads are instant and never paint it; the
 * slow path (AiM XRK parsing) shows the live phase message.
 */
export function FileLoadingOverlay() {
  const [state, setState] = useState<FileLoadingState | null>(getFileLoading());

  useEffect(() => subscribeFileLoading(setState), []);

  if (!state) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background/70 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="w-10 h-10 animate-spin text-primary" />
      <p className="text-sm font-medium text-foreground">{state.message}</p>
    </div>
  );
}
