/**
 * BuildLoggerDialog — the landing page's "Build your own logger" modal
 * (plan 0010 follow-up). Shows the Fledgling (the same photo the
 * download picker uses), pitches the DIY build, links the GitHub repo,
 * and — the headline action — launches the firmware simulator so people
 * can try the device before soldering anything.
 */

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { interceptExternal } from "@/lib/platform";

const FLEDGLING_IMAGE = "/loggers/fledgling.png";
const REPO_URL = "https://github.com/TheAngryRaven/DovesDataLogger";

interface BuildLoggerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BuildLoggerDialog({ open, onOpenChange }: BuildLoggerDialogProps) {
  const { t } = useTranslation("landing");
  const navigate = useNavigate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("buildDialog.title")}</DialogTitle>
          <DialogDescription>{t("buildDialog.tagline")}</DialogDescription>
        </DialogHeader>

        <img
          src={FLEDGLING_IMAGE}
          alt={t("buildDialog.imageAlt")}
          className="mx-auto max-h-52 rounded-lg object-contain"
        />

        <p className="text-sm text-muted-foreground">{t("buildDialog.body")}</p>

        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={() => { onOpenChange(false); navigate("/simulator"); }}>
            <PlayCircle className="mr-2 h-5 w-5" />
            {t("buildDialog.simulator")}
          </Button>
          <Button
            variant="outline"
            asChild
          >
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => interceptExternal(e, REPO_URL)}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t("buildDialog.github")}
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
