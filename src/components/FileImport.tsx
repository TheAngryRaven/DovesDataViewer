import { useCallback, useState } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseDatalog } from '@/lib/nmeaParser';
import { ParsedData } from '@/types/racing';

interface FileImportProps {
  onDataLoaded: (data: ParsedData) => void;
}

export function FileImport({ onDataLoaded }: FileImportProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setFileName(file.name);

    try {
      const text = await file.text();
      const data = parseDatalog(text);
      onDataLoaded(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file');
    } finally {
      setIsLoading(false);
    }
  }, [onDataLoaded]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      const input = document.createElement('input');
      input.type = 'file';
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input.files = dataTransfer.files;
      handleFileChange({ target: input } as React.ChangeEvent<HTMLInputElement>);
    }
  }, [handleFileChange]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 p-8 border-2 border-dashed border-border rounded-lg bg-card/50 hover:border-primary/50 transition-colors cursor-pointer"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        {isLoading ? (
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
        ) : (
          <Upload className="w-12 h-12" />
        )}
        <p className="text-lg font-medium">
          {isLoading ? 'Processing...' : 'Drop datalog file here'}
        </p>
        <p className="text-sm">
          Supports CSV with NMEA sentences, or .nmea files
        </p>
      </div>

      <label>
        <input
          type="file"
          accept=".csv,.nmea,.txt"
          onChange={handleFileChange}
          className="hidden"
          disabled={isLoading}
        />
        <Button variant="outline" disabled={isLoading} asChild>
          <span className="cursor-pointer">
            <FileText className="w-4 h-4 mr-2" />
            Browse Files
          </span>
        </Button>
      </label>

      {fileName && !error && (
        <p className="text-sm text-muted-foreground font-mono">
          Loaded: {fileName}
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive font-medium">
          Error: {error}
        </p>
      )}
    </div>
  );
}
