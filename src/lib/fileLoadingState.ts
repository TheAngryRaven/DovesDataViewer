// Tiny host pub/sub for the "a file is being loaded" overlay — framework-agnostic
// (mirrors garageEvents.ts) so the parser layer can signal loading without
// importing React. `parseDatalogFile()` brackets every session load with
// begin/end; the <FileLoadingOverlay> subscribes and dims the screen. Fast
// formats finish in the same tick (overlay never paints); slow ones — notably
// AiM XRK parsing — show the spinner + live phase message.

export interface FileLoadingState {
  /** Human-readable status shown under the spinner. */
  message: string;
}

type Listener = (state: FileLoadingState | null) => void;

let current: FileLoadingState | null = null;
const listeners = new Set<Listener>();

export function getFileLoading(): FileLoadingState | null {
  return current;
}

function emit(state: FileLoadingState | null): void {
  current = state;
  for (const listener of listeners) listener(current);
}

/** Show the overlay with an initial message. */
export function beginFileLoading(message = "Loading file…"): void {
  emit({ message });
}

/** Update the message while loading (e.g. XRK phase progress). No-op if idle. */
export function updateFileLoading(message: string): void {
  if (current) emit({ message });
}

/** Hide the overlay. */
export function endFileLoading(): void {
  emit(null);
}

/** Subscribe to loading-state changes; returns an unsubscribe fn. */
export function subscribeFileLoading(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
