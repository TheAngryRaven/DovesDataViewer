import { useState, useSyncExternalStore } from 'react';
import { Bug, Copy, Trash2, X, ChevronUp } from 'lucide-react';
import {
  debugLog,
  isDebugEnabled,
  formatEntriesForCopy,
  type DebugEntry,
  type DebugLevel,
} from '@/lib/debugConsole';

const LEVEL_CLASS: Record<DebugLevel, string> = {
  log: 'text-foreground/80',
  info: 'text-foreground/80',
  warn: 'text-warning',
  error: 'text-destructive',
};

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

/**
 * On-screen debug console for mobile (no dev-tools). Self-gates on the `?dbg`
 * flag (see `lib/debugConsole.ts`), so it renders nothing in normal use and
 * adds no chrome unless explicitly enabled.
 */
export function DebugConsole() {
  const entries = useSyncExternalStore(debugLog.subscribe, debugLog.getSnapshot, () => [] as DebugEntry[]);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Evaluated once per mount — the flag doesn't change within a page session.
  if (!isDebugEnabled() || hidden) return null;

  const errorCount = entries.filter((e) => e.level === 'error').length;

  const handleCopy = () => {
    void navigator.clipboard?.writeText(formatEntriesForCopy(entries)).catch(() => undefined);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-2 right-2 z-[9999] flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs font-mono shadow-lg backdrop-blur"
      >
        <Bug className="h-3.5 w-3.5" />
        <span>{entries.length}</span>
        {errorCount > 0 && <span className="text-destructive">({errorCount} err)</span>}
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[9999] max-h-[45vh] border-t border-border bg-card/95 font-mono text-[11px] shadow-2xl backdrop-blur flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <Bug className="h-3.5 w-3.5 shrink-0" />
        <span className="font-semibold">Debug</span>
        <span className="text-muted-foreground">{entries.length} lines</span>
        {errorCount > 0 && <span className="text-destructive">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={handleCopy} title="Copy" className="rounded p-1 hover:bg-muted">
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => debugLog.clear()} title="Clear" className="rounded p-1 hover:bg-muted">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setCollapsed(true)} title="Collapse" className="rounded p-1 hover:bg-muted">
            <span className="block h-3.5 w-3.5 text-center leading-[14px]">_</span>
          </button>
          <button type="button" onClick={() => setHidden(true)} title="Close" className="rounded p-1 hover:bg-muted">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="overflow-y-auto px-2 py-1 leading-snug">
        {entries.length === 0 ? (
          <p className="text-muted-foreground">No log output yet.</p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className={`whitespace-pre-wrap break-words ${LEVEL_CLASS[e.level]}`}>
              <span className="text-muted-foreground">{formatTime(e.time)} </span>
              {e.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
