import { Info, Github } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { interceptExternal } from "@/lib/platform";

// Section ids — order is the display order; the heading/body text lives in the
// `landing` locale (about.sections.<id>).
const SECTION_IDS = ["offline", "data", "community", "oss"] as const;

// Open-source repositories — shown under the "Free & Open Source" section. Repo
// names are proper nouns, intentionally not translated.
const GITHUB_LINKS: Array<{ href: string; label: string }> = [
  { href: "https://github.com/TheAngryRaven/DovesDataViewer", label: "DataViewer" },
  { href: "https://github.com/TheAngryRaven/DovesDataLogger", label: "Datalogger" },
  { href: "https://github.com/TheAngryRaven/DovesLapTimer", label: "Timer Library" },
  { href: "https://github.com/TheAngryRaven/DataViewer_coach", label: "Coach Plugin" },
];

export function AboutDialog() {
  const { t } = useTranslation("landing");
  const features = t("about.features", { returnObjects: true }) as string[];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Info className="w-4 h-4" />
          <span className="hidden sm:inline">{t("about.trigger")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("about.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-muted-foreground">
          {SECTION_IDS.map((id) => (
            <div key={id}>
              <h3 className="font-semibold text-foreground mb-1">{t(`about.sections.${id}.heading`)}</h3>
              <p>
                <Trans
                  t={t}
                  i18nKey={`about.sections.${id}.body`}
                  components={{ strong: <strong className="text-foreground" /> }}
                />
              </p>
            </div>
          ))}

          {/* Source repos — sits with the open-source section, above the feature list. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {GITHUB_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => interceptExternal(e, link.href)}
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="w-4 h-4" />
                <span className="text-xs">{link.label}</span>
              </a>
            ))}
          </div>

          <div className="border-t border-border pt-4 mt-4">
            <h3 className="font-semibold text-foreground mb-2">{t("about.featuresHeading")}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {features.map((feat, i) => (
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
