/**
 * SimGuide — the simulator's "readme" (plan 0010 follow-up).
 *
 * A short lead paragraph plus a collapsible how-to: booting, controls,
 * replaying/ending/reviewing a session, the race-mode page reference,
 * and the not-simulated notes. Pure content — every string lives in the
 * `simulator` i18n namespace.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, ChevronDown } from "lucide-react";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const STEPS = ["boot", "controls", "replay", "ending", "review"] as const;
const PAGES = [
  "stats", "speed", "rpm", "lapTime", "pace", "best", "optimal",
  "history", "end",
] as const;
const SYSTEM = [
  "splash", "gpsStatus", "menu", "race", "reviewList", "reviewResults",
  "transfer", "camera", "sdFormat", "warnings", "charging",
] as const;

export function SimGuide() {
  const { t } = useTranslation("simulator");
  const [open, setOpen] = useState(true);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border bg-card/50"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 p-4 text-left">
        <BookOpen className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm font-semibold">{t("guide.title")}</span>
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 px-4 pb-4 text-sm">
        <p className="text-muted-foreground">{t("guide.lead")}</p>

        <div className="space-y-3">
          {STEPS.map((k) => (
            <div key={k}>
              <p className="font-medium">{t(`guide.steps.${k}.title`)}</p>
              <p className="text-muted-foreground">{t(`guide.steps.${k}.body`)}</p>
            </div>
          ))}
        </div>

        <div>
          <p className="mb-2 font-medium">{t("guide.pagesTitle")}</p>
          <ul className="space-y-1">
            {PAGES.map((k) => (
              <li key={k} className="flex gap-2">
                <span className="min-w-28 shrink-0 font-medium">
                  {t(`guide.pages.${k}.name`)}
                </span>
                <span className="text-muted-foreground">
                  {t(`guide.pages.${k}.desc`)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-2 font-medium">{t("guide.systemTitle")}</p>
          <ul className="space-y-1">
            {SYSTEM.map((k) => (
              <li key={k} className="flex gap-2">
                <span className="min-w-28 shrink-0 font-medium">
                  {t(`guide.system.${k}.name`)}
                </span>
                <span className="text-muted-foreground">
                  {t(`guide.system.${k}.desc`)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">{t("guide.systemNote")}</p>
        </div>

        <p className="text-xs text-muted-foreground">{t("guide.note")}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}
