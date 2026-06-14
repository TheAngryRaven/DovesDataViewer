import { Info } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

// Section ids — order is the display order; the heading/body text lives in the
// `landing` locale (about.sections.<id>).
const SECTION_IDS = ["offline", "data", "community", "oss"] as const;

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
