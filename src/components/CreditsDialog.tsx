import { BookOpen, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const CREDITS: ReadonlyArray<readonly [name: string, url: string]> = [
  ["React", "https://react.dev"],
  ["Vite", "https://vite.dev"],
  ["TypeScript", "https://www.typescriptlang.org"],
  ["Tailwind CSS", "https://tailwindcss.com"],
  ["shadcn/ui", "https://ui.shadcn.com"],
  ["Radix UI", "https://www.radix-ui.com"],
  ["Leaflet", "https://leafletjs.com"],
  ["OpenStreetMap", "https://www.openstreetmap.org"],
  ["Lucide Icons", "https://lucide.dev"],
  ["TanStack Query", "https://tanstack.com/query"],
  ["i18next", "https://www.i18next.com"],
  ["react-i18next", "https://react.i18next.com"],
  ["IEM ASOS (Iowa State)", "https://mesonet.agron.iastate.edu"],
  ["NWS API", "https://www.weather.gov/documentation/services-web-api"],
  ["Open-Meteo", "https://open-meteo.com"],
  ["Savitzky-Golay (ml.js)", "https://github.com/mljs/savitzky-golay"],
  ["Sonner", "https://sonner.emilkowal.dev"],
  ["react-resizable-panels", "https://github.com/bvaughn/react-resizable-panels"],
  ["dnd kit", "https://dndkit.com"],
  ["mp4-muxer", "https://github.com/Vanilagy/mp4-muxer"],
  ["fix-webm-duration", "https://github.com/yusitnikov/fix-webm-duration"],
  ["JSZip", "https://stuk.github.io/jszip"],
  ["MoTeC i2", "https://www.motec.com.au"],
  ["libxrk", "https://github.com/m3rlin45/libxrk"],
  ["TrackDataAnalysis", "https://github.com/racer-coder/TrackDataAnalysis"],
];

export function CreditsDialog() {
  const { t } = useTranslation("landing");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
          <BookOpen className="w-3 h-3" />
          {t("credits.trigger")}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("credits.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground mb-4">
          {t("credits.intro")}
        </p>
        <div className="grid grid-cols-1 gap-2">
          {CREDITS.map(([name, url]) => (
            <a
              key={name}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-accent transition-colors text-sm"
            >
              <span className="font-medium text-foreground">{name}</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </a>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
