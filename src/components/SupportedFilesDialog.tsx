import { FileText } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { interceptExternal } from "@/lib/platform";

const LOGGER_URL = "https://github.com/TheAngryRaven/DovesDataLogger";
const LIBXRK_URL = "https://github.com/m3rlin45/libxrk";

// Format ids in display order; their name/body text lives in the `landing`
// locale (supportedFiles.primary.<id> / .secondary.<id>). Format names,
// extensions and brand/library links stay literal inside the locale strings.
const PRIMARY_IDS = ["dove", "dovex", "xrk", "iracing", "nmea"] as const;
const SECONDARY_IDS = ["ubx", "vbo", "motecLd", "motecCsv", "alfano", "aimCsv"] as const;
const EXPERIMENTAL = new Set(["motecLd", "motecCsv", "alfano", "aimCsv"]);

// Shared rich-text components for the format bodies. `<Trans>` only uses the
// tags a given string references, so one map covers every format.
const FORMAT_COMPONENTS = {
  code: <code className="text-primary" />,
  logger: (
    <a href={LOGGER_URL} target="_blank" rel="noopener noreferrer" onClick={(e) => interceptExternal(e, LOGGER_URL)} className="text-primary hover:underline" />
  ),
  libxrk: (
    <a href={LIBXRK_URL} target="_blank" rel="noopener noreferrer" onClick={(e) => interceptExternal(e, LIBXRK_URL)} className="text-primary hover:underline" />
  ),
};

export function SupportedFilesDialog() {
  const { t } = useTranslation("landing");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileText className="w-4 h-4" />
          <span className="hidden sm:inline">{t("supportedFiles.trigger")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("supportedFiles.title")}</DialogTitle>
          <DialogDescription>{t("supportedFiles.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {PRIMARY_IDS.map((id) => (
            <div key={id} className="p-3 rounded-md border border-primary/30 bg-primary/5">
              <p className="font-semibold text-foreground">{t(`supportedFiles.primary.${id}.name`)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                <Trans t={t} i18nKey={`supportedFiles.primary.${id}.body`} components={FORMAT_COMPONENTS} />
              </p>
            </div>
          ))}

          <div className="border-t border-border my-2" />

          {SECONDARY_IDS.map((id) => (
            <div key={id} className="p-3 rounded-md border border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-foreground">{t(`supportedFiles.secondary.${id}.name`)}</p>
                {EXPERIMENTAL.has(id) && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 font-medium">
                    {t("supportedFiles.experimental")}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                <Trans t={t} i18nKey={`supportedFiles.secondary.${id}.body`} components={FORMAT_COMPONENTS} />
              </p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
