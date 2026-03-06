import { useState, useCallback, useRef } from "react";
import { Download, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface VideoExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (options: ExportOptions) => void;
  isExporting: boolean;
  progress: number; // 0-1
  videoFileName: string | null;
}

export interface ExportOptions {
  includeOverlays: boolean;
  quality: "standard" | "high";
}

export function VideoExportDialog({ open, onOpenChange, onExport, isExporting, progress, videoFileName }: VideoExportDialogProps) {
  const [includeOverlays, setIncludeOverlays] = useState(true);
  const [quality, setQuality] = useState<"standard" | "high">("standard");

  const handleExport = useCallback(() => {
    onExport({ includeOverlays, quality });
  }, [includeOverlays, quality, onExport]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            Export Video
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {videoFileName && (
            <p className="text-xs text-muted-foreground">Source: {videoFileName}</p>
          )}

          <div className="flex items-center justify-between">
            <Label htmlFor="export-overlays">Include Overlays</Label>
            <Switch
              id="export-overlays"
              checked={includeOverlays}
              onCheckedChange={setIncludeOverlays}
              disabled={isExporting}
            />
          </div>

          <div className="space-y-1">
            <Label>Quality</Label>
            <Select value={quality} onValueChange={(v) => setQuality(v as "standard" | "high")} disabled={isExporting}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard (720p, 30fps)</SelectItem>
                <SelectItem value="high">High (Original resolution)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isExporting && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Exporting… {Math.round(progress * 100)}%
              </div>
              <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isExporting}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={handleExport}
              disabled={isExporting}
            >
              <Download className="w-4 h-4" />
              Export
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Video export uses your browser's built-in encoding. Large videos may take a while. The export plays through the video in real-time to capture each frame with overlays.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
