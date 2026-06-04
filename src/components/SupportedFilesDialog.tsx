import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const PRIMARY_FORMATS = [
  {
    name: "Dove CSV",
    body: <>Simple CSV with millisecond Unix timestamps, GPS data, RPM, and hardware accelerometer readings. The native format of <a href="https://github.com/TheAngryRaven/DovesDataLogger" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">DovesDataLogger</a>. Extension: <code className="text-primary">.dove</code></>,
  },
  {
    name: "Dovex (Extended Dove)",
    body: <>Extended Dove format with a 4096-byte metadata header containing session info (driver, course, lap times) followed by standard Dove CSV GPS data. Extension: <code className="text-primary">.dovex</code></>,
  },
  {
    name: "AiM XRK / XRZ (Binary)",
    body: <>AiM's native binary telemetry from MyChron / SoloDL loggers, including the zlib-compressed <code className="text-primary">.xrz</code> variant. Parsed entirely in your browser by <a href="https://github.com/m3rlin45/libxrk" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">libxrk</a> compiled to WebAssembly — fast and fully offline, like every other format. Extensions: <code className="text-primary">.xrk</code>, <code className="text-primary">.xrz</code></>,
  },
  {
    name: "NMEA / CSV (Tab-Delimited)",
    body: <>Tab-delimited CSV with NMEA sentences — the legacy format used by our earlier custom dataloggers. Extensions: <code className="text-primary">.nmea</code>, <code className="text-primary">.csv</code>, <code className="text-primary">.txt</code></>,
  },
];

const SECONDARY_FORMATS: Array<{ name: string; experimental?: boolean; body: React.ReactNode }> = [
  { name: "u-blox UBX Binary", body: <>Binary NAV-PVT messages from u-blox GPS receivers. Extension: <code className="text-primary">.ubx</code></> },
  { name: "Racelogic VBO", body: <>Racelogic VBOX and RaceBox export format. Extension: <code className="text-primary">.vbo</code></> },
  { name: "MoTeC LD Binary", experimental: true, body: <>Binary data from MoTeC data loggers and sim racing exports (ACC, iRacing, etc.). Extension: <code className="text-primary">.ld</code></> },
  { name: "MoTeC CSV", experimental: true, body: <>CSV exports from MoTeC i2 Pro analysis software. Extension: <code className="text-primary">.csv</code></> },
  { name: "Alfano CSV", experimental: true, body: <>CSV exports from the Alfano ADA app. Extension: <code className="text-primary">.csv</code></> },
  { name: "AiM MyChron CSV", experimental: true, body: <>CSV exports from Race Studio 3 (RS2Analysis style) for MyChron 5/6. Extension: <code className="text-primary">.csv</code></> },
];

function ExperimentalBadge() {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 font-medium">
      Experimental
    </span>
  );
}

export function SupportedFilesDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileText className="w-4 h-4" />
          <span className="hidden sm:inline">Supported Files</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Supported File Formats</DialogTitle>
          <DialogDescription>
            All parsing is done locally in your browser — nothing is uploaded.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {PRIMARY_FORMATS.map((f) => (
            <div key={f.name} className="p-3 rounded-md border border-primary/30 bg-primary/5">
              <p className="font-semibold text-foreground">{f.name}</p>
              <p className="text-xs text-muted-foreground mt-1">{f.body}</p>
            </div>
          ))}

          <div className="border-t border-border my-2" />

          {SECONDARY_FORMATS.map((f) => (
            <div key={f.name} className="p-3 rounded-md border border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-foreground">{f.name}</p>
                {f.experimental && <ExperimentalBadge />}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{f.body}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
