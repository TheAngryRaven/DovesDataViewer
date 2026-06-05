import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const SECTIONS: Array<{ heading: string; body: React.ReactNode }> = [
  {
    heading: "Works Offline & Can Be Installed",
    body: (
      <>
        HackTheTrack is a fully offline-capable web application. Once loaded, it works without an internet connection — perfect for the track. You can <strong className="text-foreground">install it like a native app</strong> on your phone, tablet, or computer by using the "Install" option in your browser menu (or the prompt that appears at the bottom of the page).
      </>
    ),
  },
  {
    heading: "Your Data Stays on Your Device",
    body: <>All data processing happens entirely in your browser, and everything is saved locally on your device by default. Cloud storage is entirely optional — nothing leaves your device unless you create an account and turn on sync.</>,
  },
  {
    heading: "Community Track Database",
    body: <>Don't see your track? You can define custom track and course layouts in the editor, then submit them to the site-wide database for everyone to use. Submissions are reviewed before being added.</>,
  },
  {
    heading: "Free & Open Source",
    body: <>Every local feature in HackTheTrack is completely free, and the source code is open and available on GitHub. Optional cloud storage has a free tier; larger storage and AI coaching are paid add-ons that cover server and model costs — but all local features will always remain free.</>,
  },
];

const FEATURES = [
  "Multi-format file support (NMEA, UBX, VBO, MoTeC, AiM CSV + XRK/XRZ, Alfano, Dove, Dovex)",
  "Automatic track & course detection within 5 miles",
  "Automatic driving direction detection (forward/reverse)",
  "Waypoint mode — lap timing anywhere, no track needed",
  "Interactive race line map with speed heatmap",
  "Braking zone detection & visualization",
  "Automatic lap detection via start/finish line",
  "3-sector split timing with optimal lap",
  "Pro graph view with multi-series telemetry charts",
  "G-G diagram (friction circle) for grip-usage analysis",
  "Distance or time chart axis — laps line up by track position",
  "Reference lap overlay & pace delta comparison",
  "Multi-lap overlay — compare laps across the map & graphs at once",
  "Overlay laps from past sessions & other loggers (auto drift-aligned)",
  "Lap snapshots — fastest lap saved per engine & course for comparison",
  "Video sync with telemetry playback",
  "9 overlay gauge types (digital, analog, graph, bar, bubble, map, pace, sector, lap time)",
  "MP4 video export with overlays & audio (H.264 + AAC)",
  "Vehicle profiles & setup sheet management",
  "Frozen setup history — every session keeps the setup it ran",
  "Session notes per file",
  "BLE device integration (DovesDataLogger)",
  "Device track sync over Bluetooth",
  "Custom track & course editor with community submissions",
  "Local weather lookup",
  "Dark & light mode",
  "PWA — installable & fully offline",
];

export function AboutDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Info className="w-4 h-4" />
          <span className="hidden sm:inline">About</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>About HackTheTrack</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-muted-foreground">
          {SECTIONS.map((s) => (
            <div key={s.heading}>
              <h3 className="font-semibold text-foreground mb-1">{s.heading}</h3>
              <p>{s.body}</p>
            </div>
          ))}

          <div className="border-t border-border pt-4 mt-4">
            <h3 className="font-semibold text-foreground mb-2">Features</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {FEATURES.map((feat, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-primary mt-0.5">•</span>
                  <span>{feat}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
