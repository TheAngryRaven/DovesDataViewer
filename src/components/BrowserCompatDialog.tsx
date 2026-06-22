import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { detectCapabilities, type CapabilityCheck } from "@/lib/browserCompat";
import { isNativeApp } from "@/lib/platform";

const levelIcon = (level: CapabilityCheck["level"]) => {
  switch (level) {
    case "green":
      return <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />;
    case "yellow":
      return <AlertTriangle className="w-4 h-4 text-blue-500 shrink-0" />;
    case "red":
      return <XCircle className="w-4 h-4 text-muted-foreground shrink-0" />;
  }
};

export function BrowserCompatDialog() {
  const { t } = useTranslation("landing");
  const checks = useMemo(() => detectCapabilities(), []);
  const hasIssues = checks.some((c) => c.level !== "green");
  // On the native shell it's a device, not a browser — relabel accordingly.
  const native = isNativeApp();
  const triggerLabel = native ? t("browserCompat.triggerNative") : t("browserCompat.trigger");
  const titleLabel = native ? t("browserCompat.titleNative") : t("browserCompat.title");
  const descriptionLabel = native ? t("browserCompat.descriptionNative") : t("browserCompat.description");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={
            hasIssues
              ? "border-blue-500/50 text-blue-500 hover:bg-blue-500/10 hover:text-blue-400"
              : "text-muted-foreground border-border/50 opacity-60 hover:opacity-100"
          }
        >
          <Monitor className="w-3.5 h-3.5 mr-1.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            {titleLabel}
          </DialogTitle>
          <DialogDescription>
            {descriptionLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {checks.map((check) => (
            <div
              key={check.feature}
              className="flex items-center justify-between gap-3 py-1.5 px-2 rounded bg-muted/30"
            >
              <div className="flex items-center gap-2 min-w-0">
                {levelIcon(check.level)}
                <span className="text-sm text-foreground">{t(`browserCompat.features.${check.feature}`)}</span>
              </div>
              <span className="text-xs text-muted-foreground shrink-0 font-mono">
                {t(`browserCompat.statuses.${check.status}`)}
              </span>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed mt-2">
          {t("browserCompat.note")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
