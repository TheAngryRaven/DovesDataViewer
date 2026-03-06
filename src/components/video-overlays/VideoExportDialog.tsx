import { useState, useCallback } from "react";
import { Download, Save, Loader2, HardDrive, Video } from "lucide-react";
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
  hasStoredVideo?: boolean;
  hasLapSelected?: boolean;
  onSaveExisting?: () => void;
}

export interface ExportOptions {
  includeOverlays: boolean;
  quality: "standard" | "high";
  range: "full" | "lap";
  destination: "device" | "app";
  startTime?: number;
  endTime?: number;
}

export function VideoExportDialog({
  open, onOpenChange, onExport, isExporting, progress, videoFileName,
  hasStoredVideo = false, hasLapSelected = false, onSaveExisting,
}: VideoExportDialogProps) {
  const [includeOverlays, setIncludeOverlays] = useState(true);
  const [quality, setQuality] = useState<"standard" | "high">("standard");
  const [range, setRange] = useState<"full" | "lap">("full");

  const handleExport = useCallback((destination: "device" | "app") => {
    onExport({ includeOverlays, quality, range, destination });
  }, [includeOverlays, quality, range, onExport]);

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

          {/* Already saved notice */}
          {hasStoredVideo && (
            <div className="flex items-center gap-2 p-2 rounded-md bg-primary/10 border border-primary/20">
              <Video className="w-4 h-4 text-primary shrink-0" />
              <p className="text-xs text-foreground">
                Video already saved to app.{" "}
                {onSaveExisting && (
                  <button
                    className="text-primary underline hover:no-underline"
                    onClick={onSaveExisting}
                  >
                    Download copy
                  </button>
                )}
              </p>
            </div>
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

          <div className="space-y-1">
            <Label>Range</Label>
            <Select value={range} onValueChange={(v) => setRange(v as "full" | "lap")} disabled={isExporting || !hasLapSelected}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full Session</SelectItem>
                <SelectItem value="lap" disabled={!hasLapSelected}>Current Lap</SelectItem>
              </SelectContent>
            </Select>
            {!hasLapSelected && range === "full" && (
              <p className="text-xs text-muted-foreground">Select a lap to enable lap export</p>
            )}
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
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => handleExport("app")}
              disabled={isExporting}
              title="Save exported video to the app for auto-loading"
            >
              <Save className="w-4 h-4" />
              Save to App
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={() => handleExport("device")}
              disabled={isExporting}
              title="Download exported video file"
            >
              <HardDrive className="w-4 h-4" />
              Save to Device
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Video export plays through the video in real-time to capture each frame with overlays.
            "Save to App" stores the video for auto-loading next session.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
