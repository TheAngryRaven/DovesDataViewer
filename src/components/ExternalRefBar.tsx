import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileEntry } from '@/lib/fileStorage';
import { formatLapTime } from '@/lib/lapCalculation';
import { FileSearch, Loader2, X } from 'lucide-react';

interface ExternalRefBarProps {
  externalRefLabel: string | null;
  savedFiles: FileEntry[];
  onLoadFileForRef: (fileName: string) => Promise<Array<{ lapNumber: number; lapTimeMs: number }> | null>;
  onSelectExternalLap: (fileName: string, lapNumber: number) => void;
  onClearExternalRef: () => void;
  onOpen?: () => void;
}

export function ExternalRefBar({
  externalRefLabel,
  savedFiles,
  onLoadFileForRef,
  onSelectExternalLap,
  onClearExternalRef,
  onOpen,
}: ExternalRefBarProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stage, setStage] = useState<'files' | 'laps'>('files');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [laps, setLaps] = useState<Array<{ lapNumber: number; lapTimeMs: number }>>([]);

  const handleOpenDialog = () => {
    setStage('files');
    setError(null);
    setSelectedFile(null);
    setLaps([]);
    onOpen?.();
    setDialogOpen(true);
  };

  const handleFileClick = async (fileName: string) => {
    setLoading(true);
    setError(null);
    setSelectedFile(fileName);
    try {
      const result = await onLoadFileForRef(fileName);
      if (!result || result.length === 0) {
        setError('No laps detected for the current track/course.');
        setLoading(false);
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

  const handleLapClick = (lapNumber: number) => {
    if (selectedFile) {
      onSelectExternalLap(selectedFile, lapNumber);
      setDialogOpen(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 border-b border-border text-sm">
        <span className="text-muted-foreground font-medium whitespace-nowrap">External Ref:</span>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={handleOpenDialog}>
          <FileSearch className="w-3.5 h-3.5" />
          Choose Log
        </Button>
        <span className="text-muted-foreground truncate">
          {externalRefLabel ?? 'No session loaded'}
        </span>
        {externalRefLabel && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-auto shrink-0" onClick={onClearExternalRef}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {stage === 'files' ? 'Choose a Log File' : `Laps — ${selectedFile}`}
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

          {!loading && !error && stage === 'laps' && (
            <div className="overflow-y-auto flex-1 -mx-2">
              <ul className="space-y-0.5">
                {laps.map((lap) => (
                  <li key={lap.lapNumber}>
                    <button
                      className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted/50 transition-colors font-mono"
                      onClick={() => handleLapClick(lap.lapNumber)}
                    >
                      Lap {lap.lapNumber} : {formatLapTime(lap.lapTimeMs)}
                    </button>
                  </li>
                ))}
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
    </>
  );
}
