import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FileEntry } from '@/lib/fileStorage';
import { formatLapTime } from '@/lib/lapCalculation';
import { externalOverlayId, type OverlayLine } from '@/lib/lapOverlays';
import { Layers, Loader2, Trophy, Check } from 'lucide-react';

interface OverlayFilePickerProps {
  hasCourse: boolean;
  savedFiles: FileEntry[];
  overlayLines: OverlayLine[];
  onLoadOverlayFile: (fileName: string) => Promise<Array<{ lapNumber: number; lapTimeMs: number }> | null>;
  onAddExternalOverlay: (fileName: string, lapNumber: number) => void;
  onToggleOverlay: (id: string) => void;
  onOpen?: () => void;
}

/**
 * Adds laps from *other saved files* as overlay racing lines (cross-session /
 * cross-logger comparison). Two-stage flow — pick a file, then toggle its laps
 * on/off as overlays — staying open so several can be added at once.
 */
export function OverlayFilePicker({
  hasCourse, savedFiles, overlayLines,
  onLoadOverlayFile, onAddExternalOverlay, onToggleOverlay, onOpen,
}: OverlayFilePickerProps) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<'files' | 'laps'>('files');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [laps, setLaps] = useState<Array<{ lapNumber: number; lapTimeMs: number }>>([]);

  if (!hasCourse) return null;

  const externalCount = overlayLines.filter((l) => l.id.startsWith('file:')).length;

  const openDialog = () => {
    setStage('files');
    setError(null);
    setSelectedFile(null);
    setLaps([]);
    onOpen?.();
    setOpen(true);
  };

  const handleFileClick = async (fileName: string) => {
    setLoading(true);
    setError(null);
    setSelectedFile(fileName);
    try {
      const result = await onLoadOverlayFile(fileName);
      if (!result || result.length === 0) {
        setError('No laps detected for the current track/course.');
        return;
      }
      setLaps(result);
      setStage('laps');
    } catch {
      setError('Failed to load or parse the file.');
    } finally {
      setLoading(false);
    }
  };

  const fastestIdx = laps.reduce((minIdx, lap, idx, arr) => (lap.lapTimeMs < arr[minIdx].lapTimeMs ? idx : minIdx), 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-sm" onClick={openDialog}>
          <Layers className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Overlay file</span>
          {externalCount > 0 && (
            <span className="ml-0.5 rounded bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
              {externalCount}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {stage === 'files' ? 'Overlay a lap from another file' : `Laps — ${selectedFile}`}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="py-4 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => { setStage('files'); setError(null); }}>
              Back to files
            </Button>
          </div>
        )}

        {!loading && !error && stage === 'files' && (
          <div className="overflow-y-auto flex-1 -mx-2">
            {savedFiles.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No saved files found.</p>
            ) : (
              <ul className="space-y-0.5">
                {savedFiles.map((file) => (
                  <li key={file.name}>
                    <button
                      className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted/50 transition-colors truncate"
                      onClick={() => handleFileClick(file.name)}
                    >
                      {file.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!loading && !error && stage === 'laps' && selectedFile && (
          <div className="overflow-y-auto flex-1 -mx-2">
            <ul className="space-y-0.5">
              {laps.map((lap, idx) => {
                const id = externalOverlayId(selectedFile, lap.lapNumber);
                const overlay = overlayLines.find((l) => l.id === id);
                const isFastest = idx === fastestIdx;
                return (
                  <li key={lap.lapNumber}>
                    <button
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-mono transition-colors hover:bg-muted/50"
                      onClick={() => (overlay ? onToggleOverlay(id) : onAddExternalOverlay(selectedFile, lap.lapNumber))}
                    >
                      {overlay ? (
                        <Check className="w-3.5 h-3.5 shrink-0" style={{ color: overlay.color }} />
                      ) : isFastest ? (
                        <Trophy className="w-3.5 h-3.5 shrink-0 text-racing-lapBest" />
                      ) : (
                        <Layers className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className={isFastest && !overlay ? 'text-racing-lapBest' : ''}>
                        Lap {lap.lapNumber} : {formatLapTime(lap.lapTimeMs)}
                      </span>
                      {overlay && <span className="ml-auto text-[11px] text-muted-foreground">on map</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="px-3 pt-2">
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setStage('files'); setError(null); }}>
                ← Back to files
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
