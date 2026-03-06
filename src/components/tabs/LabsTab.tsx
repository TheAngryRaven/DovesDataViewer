import { memo } from "react";
import { FlaskConical, Download, PenLine } from "lucide-react";

export const LabsTab = memo(function LabsTab() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-sm space-y-5 text-center px-4">
        <FlaskConical className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <p className="text-sm font-medium text-foreground">Labs Features</p>
        <p className="text-xs text-muted-foreground">
          These are experimental — expect rough edges and the occasional gremlin.
        </p>

        <div className="space-y-3 text-left">
          <div className="flex gap-3 p-3 rounded-md border border-border bg-muted/30">
            <Download className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Video Export</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Save or download your video with telemetry overlays baked in for sharing or later playback. 
                Export quality and seeking can be a bit wonky — we're still ironing it out.
              </p>
            </div>
          </div>

          <div className="flex gap-3 p-3 rounded-md border border-border bg-muted/30">
            <PenLine className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Track Layout Drawing</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Draw track outlines on the satellite map in the Track Editor. Used for future automatic track detection on DovesDataLogger hardware.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
