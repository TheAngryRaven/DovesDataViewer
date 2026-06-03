import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileEntry, listAllMetadata } from '@/lib/fileStorage';
import { Lap } from '@/types/racing';
import { formatLapTime } from '@/lib/lapCalculation';
import { formatSessionDisplayName } from '@/lib/fileBrowserTree';
import { FileSearch, Loader2, X, Trophy, Target, ChevronDown } from 'lucide-react';

interface ExternalRefBarProps {
  externalRefLabel: string | null;
  savedFiles: FileEntry[];
  onLoadFileForRef: (fileName: string) => Promise<Array<{ lapNumber: number; lapTimeMs: number }> | null>;
  onSelectExternalLap: (fileName: string, lapNumber: number) => void;
  onClearExternalRef: () => void;
  onOpen?: () => void;
  /** Extra action rendered next to the picker button (e.g. load a snapshot as reference). */
  trailing?: React.ReactNode;
  // Current-session laps — the first section of the picker.
  laps?: Lap[];
  referenceLapNumber?: number | null;
  onSetReference?: (lapNumber: number) => void;
}

/**
 * Reference-lap picker. The bar shows the active reference + a clear button; its
 * dialog has two collapsible sections — laps from **this session** and laps from
 * **another saved file** — so a reference can be chosen from either place. Files
 * are listed by their session date-name (matching the file browser), never the
 * raw file name.
 */
export function ExternalRefBar({
  externalRefLabel,
  savedFiles,
  onLoadFileForRef,
  onSelectExternalLap,
  onClearExternalRef,
  onOpen,
  trailing,
  laps = [],
  referenceLapNumber = null,
  onSetReference,
}: ExternalRefBarProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showSession, setShowSession] = useState(true);
  const [showFiles, setShowFiles] = useState(true);
  const [nameByFile, setNameByFile] = useState<Map<string, number | undefined>>(new Map());

  // "Another file" sub-flow
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileLaps, setFileLaps] = useState<Array<{ lapNumber: number; lapTimeMs: number }>>([]);

  const fileLabel = (fileName: string) => formatSessionDisplayName(nameByFile.get(fileName), fileName);

  // Bar label covers both reference kinds (external file or a session lap).
  const refLabel = externalRefLabel
    ?? (referenceLapNumber !== null ? `Lap ${referenceLapNumber}` : null);

  const handleOpenDialog = async () => {
    setSelectedFile(null);
    setFileLaps([]);
    setError(null);
    onOpen?.();
    setDialogOpen(true);
    try {
      const metas = await listAllMetadata();
      setNameByFile(new Map(metas.map((m) => [m.fileName, m.sessionStartTime])));
    } catch {
      /* date names just fall back to raw file names */
    }
  };

  const handleFileClick = async (fileName: string) => {
    setLoading(true);
    setError(null);
    setSelectedFile(fileName);
    try {
      const result = await onLoadFileForRef(fileName);
      if (!result || result.length === 0) {
        setError('No laps detected for the current track/course.');
        return;
      }
      setFileLaps(result);
    } catch {
      setError('Failed to load or parse the file.');
    } finally {
      setLoading(false);
    }
  };

  const fastest = (rows: { lapTimeMs: number }[]) =>
    rows.length === 0 ? -1 : rows.reduce((m, r, i, a) => (r.lapTimeMs < a[m].lapTimeMs ? i : m), 0);
  const sessionFastest = fastest(laps);
  const fileFastest = fastest(fileLaps);

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 border-b border-border text-sm">
        <span className="text-muted-foreground font-medium whitespace-nowrap">Reference:</span>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={handleOpenDialog}>
          <FileSearch className="w-3.5 h-3.5" />
          Select lap
        </Button>
        {trailing}
        <span className="text-muted-foreground truncate">
          {refLabel ?? 'None'}
        </span>
        {externalRefLabel && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-auto shrink-0" onClick={onClearExternalRef}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[75vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Select a reference lap</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mx-1 space-y-2 scrollbar-thin">
            {/* ── This session ───────────────────────────────────────────── */}
            <Section title="This session" open={showSession} onToggle={() => setShowSession((v) => !v)}>
              {!onSetReference || laps.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">No laps in this session.</p>
              ) : (
                <ul className="space-y-0.5">
                  {laps.map((lap, idx) => {
                    const isRef = referenceLapNumber === lap.lapNumber;
                    return (
                      <RefRow
                        key={lap.lapNumber}
                        active={isRef}
                        fastest={idx === sessionFastest}
                        label={`Lap ${lap.lapNumber} : ${formatLapTime(lap.lapTimeMs)}`}
                        onClick={() => { onSetReference(lap.lapNumber); setDialogOpen(false); }}
                      />
                    );
                  })}
                </ul>
              )}
            </Section>

            {/* ── Another file ───────────────────────────────────────────── */}
            <Section title="Another file" open={showFiles} onToggle={() => setShowFiles((v) => !v)}>
              {loading && (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {!loading && error && (
                <div className="px-3 py-3 text-center">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => { setSelectedFile(null); setError(null); }}>
                    Back to files
                  </Button>
                </div>
              )}

              {!loading && !error && !selectedFile && (
                savedFiles.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No saved files found.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {savedFiles.map((file) => (
                      <li key={file.name}>
                        <button
                          className="w-full truncate rounded px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
                          title={file.name}
                          onClick={() => handleFileClick(file.name)}
                        >
                          {fileLabel(file.name)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              )}

              {!loading && !error && selectedFile && (
                <>
                  <button
                    className="px-3 pb-1 pt-0.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => { setSelectedFile(null); setFileLaps([]); }}
                  >
                    ← {fileLabel(selectedFile)}
                  </button>
                  <ul className="space-y-0.5">
                    {fileLaps.map((lap, idx) => (
                      <RefRow
                        key={lap.lapNumber}
                        active={false}
                        fastest={idx === fileFastest}
                        label={`Lap ${lap.lapNumber} : ${formatLapTime(lap.lapTimeMs)}`}
                        onClick={() => { onSelectExternalLap(selectedFile, lap.lapNumber); setDialogOpen(false); }}
                      />
                    ))}
                  </ul>
                </>
              )}
            </Section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Section({ title, open, onToggle, children }: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
        {title}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

function RefRow({ active, fastest, label, onClick }: {
  active: boolean; fastest: boolean; label: string; onClick: () => void;
}) {
  return (
    <li>
      <button
        className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-mono transition-colors hover:bg-muted/50 ${active ? 'bg-primary/10' : ''}`}
        aria-pressed={active}
        onClick={onClick}
      >
        {active ? (
          <Target className="h-3.5 w-3.5 shrink-0 text-primary" />
        ) : fastest ? (
          <Trophy className="h-3.5 w-3.5 shrink-0 text-racing-lapBest" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className={fastest && !active ? 'text-racing-lapBest' : ''}>{label}</span>
        {active && <span className="ml-auto text-[11px] text-primary">reference</span>}
      </button>
    </li>
  );
}
