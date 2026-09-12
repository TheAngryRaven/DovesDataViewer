import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CheckCircle2, CloudOff, Loader2, WifiOff } from "lucide-react";
import { useOfflineReadiness } from "@/hooks/useOfflineReadiness";

/**
 * Settings row answering "will this still work when I lose signal?".
 *
 * The app caches itself for offline use, but that used to be invisible — you
 * found out it hadn't finished only by losing signal and refreshing. Showing the
 * state (and offering to finish the download) makes it checkable while there is
 * still a connection to fix it with.
 */
export function OfflineReadinessSection() {
  const { t } = useTranslation("settings");
  const { state, cached, total, percent, working, prepare } =
    useOfflineReadiness();

  if (state === "unsupported") return null;

  const Icon =
    state === "ready"
      ? CheckCircle2
      : state === "preparing"
        ? CloudOff
        : WifiOff;
  const tone = state === "ready" ? "text-success" : "text-warning";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${tone}`} />
        <h3 className="font-medium">{t("offline.heading")}</h3>
      </div>
      <div className="flex items-start justify-between gap-3 pl-6">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            {t(`offline.state.${state}`)}
          </p>
          {state === "preparing" && (
            <p className="text-xs text-muted-foreground">
              {t("offline.progress", { cached, total, percent })}
            </p>
          )}
        </div>
        {state !== "ready" && (
          <Button
            size="sm"
            variant="outline"
            onClick={prepare}
            disabled={working || total === 0}
            className="gap-1.5 shrink-0"
          >
            {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t("offline.prepare")}
          </Button>
        )}
      </div>
    </div>
  );
}
