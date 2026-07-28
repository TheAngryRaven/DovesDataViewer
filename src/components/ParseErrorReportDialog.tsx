import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileWarning } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { buildInfo, formatBuildLabel } from "@/lib/buildInfo";
import {
  submitParseReport,
  formatReportFileSize,
  MAX_REPORT_MESSAGE_CHARS,
  MAX_UPLOAD_BYTES,
} from "@/lib/parseReport";

/**
 * "Send this file to the support team for diagnosis" — offered when a datalog
 * fails to parse (plan 0013). Lazy-loaded by FileImport so it costs nothing
 * until a parse actually fails. Works signed in or out; a signed-in session
 * attributes the report and prefills the reply email.
 */
export function ParseErrorReportDialog({
  file,
  errorText,
  open,
  onOpenChange,
}: {
  file: File;
  /** The raw parser exception message (untranslated). */
  errorText: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("landing");
  const { user, session } = useAuth();
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!message.trim()) {
      toast({
        title: t("parseReport.missingMessage"),
        description: t("parseReport.missingMessageDesc"),
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitParseReport({
        file,
        message,
        email,
        errorText: errorText ?? undefined,
        appVersion: formatBuildLabel(buildInfo),
        accessToken: session?.access_token,
      });

      if (result.ok) {
        toast({ title: t("parseReport.sent"), description: t("parseReport.sentDesc") });
        setMessage("");
        onOpenChange(false);
      } else if (result.reason === "too-large") {
        toast({
          title: t("parseReport.tooLarge"),
          description: t("parseReport.tooLargeDesc", { max: Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)) }),
          variant: "destructive",
        });
      } else {
        toast({
          title: t("parseReport.error"),
          description:
            result.reason === "network"
              ? t("parseReport.errorNetwork")
              : result.serverError || t("parseReport.errorGeneric"),
          variant: "destructive",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("parseReport.title")}</DialogTitle>
          <DialogDescription>{t("parseReport.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
            <FileWarning className="h-4 w-4 shrink-0 text-warning" />
            <span className="truncate font-mono text-xs">
              {t("parseReport.fileLine", { name: file.name, size: formatReportFileSize(file.size) })}
            </span>
          </div>
          {errorText && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorText}</p>
          )}
          <div className="space-y-2">
            <Label>{t("parseReport.messageLabel")}</Label>
            <Textarea
              placeholder={t("parseReport.messagePlaceholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MAX_REPORT_MESSAGE_CHARS}
              rows={5}
            />
            <p className="text-xs text-muted-foreground">{t("parseReport.messageHint")}</p>
          </div>
          <div className="space-y-2">
            <Label>
              {t("parseReport.emailLabel")}{" "}
              <span className="text-xs text-muted-foreground">{t("parseReport.emailOptional")}</span>
            </Label>
            <Input
              type="email"
              placeholder={t("parseReport.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={255}
            />
          </div>
          <Button onClick={handleSubmit} disabled={submitting || !message.trim()} className="w-full">
            {submitting ? t("parseReport.sending") : t("parseReport.send")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
