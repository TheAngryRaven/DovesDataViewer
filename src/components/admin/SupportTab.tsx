import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Mail, MailOpen, Download, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatReportFileSize } from "@/lib/parseReport";
import { downloadSupportAttachment, removeSupportAttachment } from "./supportAttachment";

/**
 * Parse-error support reports (plan 0013): datalogs users sent for diagnosis
 * after a failed parse, with the attached file downloadable from the private
 * support-files bucket (admin RLS). Modeled on MessagesTab.
 */

interface ParseErrorReport {
  id: string;
  message: string;
  email: string | null;
  error_text: string | null;
  app_version: string | null;
  file_name: string;
  file_size: number;
  storage_path: string;
  compression: string | null;
  user_id: string | null;
  is_read: boolean;
  created_at: string;
  submitted_by_ip: string | null;
}

type FilterMode = "all" | "unread" | "read";

export function SupportTab({ onUnreadCount }: { onUnreadCount?: (count: number) => void }) {
  const { t } = useTranslation("admin");
  const [reports, setReports] = useState<ParseErrorReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase types lag schema; remove on next type regen
    const { data, error } = await (supabase as any)
      .from("parse_error_reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: t("support.loadError"), description: error.message, variant: "destructive" });
    } else {
      setReports(data || []);
      onUnreadCount?.((data || []).filter((r: ParseErrorReport) => !r.is_read).length);
    }
    setLoading(false);
  }, [onUnreadCount, t]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const markAsRead = async (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase types lag schema; remove on next type regen
    await (supabase as any).from("parse_error_reports").update({ is_read: true }).eq("id", id);
    setReports(prev => prev.map(r => r.id === id ? { ...r, is_read: true } : r));
    onUnreadCount?.(reports.filter(r => !r.is_read && r.id !== id).length);
  };

  const deleteReport = async (report: ParseErrorReport) => {
    // Storage object first; a failed removal keeps the row so nothing orphans.
    const storageError = await removeSupportAttachment(report.storage_path);
    if (storageError) {
      toast({ title: t("support.deleteFileError"), description: storageError, variant: "destructive" });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase types lag schema; remove on next type regen
    const { error } = await (supabase as any).from("parse_error_reports").delete().eq("id", report.id);
    if (error) {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    } else {
      const remaining = reports.filter(r => r.id !== report.id);
      setReports(remaining);
      if (expandedId === report.id) setExpandedId(null);
      onUnreadCount?.(remaining.filter(r => !r.is_read).length);
    }
  };

  const downloadFile = async (report: ParseErrorReport) => {
    setDownloadingId(report.id);
    try {
      await downloadSupportAttachment(report.storage_path, report.compression, report.file_name);
    } catch (e) {
      toast({
        title: t("support.downloadError"),
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleExpand = (report: ParseErrorReport) => {
    if (expandedId === report.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(report.id);
    if (!report.is_read) markAsRead(report.id);
  };

  const filtered = reports.filter(r => {
    if (filter === "unread") return !r.is_read;
    if (filter === "read") return r.is_read;
    return true;
  });

  if (loading) return <p className="text-muted-foreground py-4">{t("support.loading")}</p>;

  const filterLabels: Record<FilterMode, string> = {
    all: t("support.filterAll"),
    unread: t("support.filterUnread"),
    read: t("support.filterRead"),
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(["all", "unread", "read"] as FilterMode[]).map(f => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {filterLabels[f]}
            {f === "unread" && (
              <span className="ml-1 text-xs">({reports.filter(r => !r.is_read).length})</span>
            )}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={fetchReports} className="ml-auto">{t("support.refresh")}</Button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">{t("support.none")}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(report => (
            <div key={report.id} className={`border rounded-lg transition-colors ${!report.is_read ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
              <button
                onClick={() => handleExpand(report)}
                className="w-full text-left px-4 py-3 flex items-center gap-3"
              >
                {report.is_read
                  ? <MailOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                  : <Mail className="w-4 h-4 text-primary shrink-0" />
                }
                <Badge variant="outline" className="shrink-0 font-mono text-xs max-w-[14rem] truncate">
                  {report.file_name}
                </Badge>
                <span className="text-sm truncate flex-1">
                  {report.message.length > 80 ? report.message.slice(0, 80) + "…" : report.message}
                </span>
                {report.email && <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">{report.email}</span>}
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(report.created_at).toLocaleDateString()}
                </span>
              </button>

              {expandedId === report.id && (
                <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                  <p className="text-sm whitespace-pre-wrap">{report.message}</p>
                  {report.error_text && (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono">
                      {t("support.errorLabel")}: {report.error_text}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">
                      {t("support.fileLine", { name: report.file_name, size: formatReportFileSize(report.file_size) })}
                    </span>
                    {report.app_version && <span>{t("support.versionLine", { version: report.app_version })}</span>}
                    {report.email && <span>{t("support.emailLine", { email: report.email })}</span>}
                    {report.user_id && <span className="font-mono">{t("support.userLine", { id: report.user_id })}</span>}
                    <span>{t("support.ipLine", { ip: report.submitted_by_ip || t("support.unknownIp") })}</span>
                    <span>{new Date(report.created_at).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-7" disabled={downloadingId === report.id} onClick={() => downloadFile(report)}>
                      {downloadingId === report.id
                        ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        : <Download className="w-3 h-3 mr-1" />}
                      {t("support.download")}
                    </Button>
                    <Button size="sm" variant="destructive" className="ml-auto h-7" onClick={() => deleteReport(report)}>
                      <Trash2 className="w-3 h-3 mr-1" /> {t("common.delete")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
