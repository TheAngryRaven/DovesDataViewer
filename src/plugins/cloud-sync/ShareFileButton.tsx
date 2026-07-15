import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import type { FileRowContext } from "@/plugins/mounts";
import { isSampleFileName } from "@/lib/sampleData";
import { fileSyncStatus, getFileRecord, subscribeFileSync } from "./fileSync";
import ShareSessionDialog from "./ShareSessionDialog";

// Per-row share affordance (plan 0009), mounted next to the cloud sync toggle.
// Only cloud-synced logs are shareable (the share copies the cloud workflow's
// blob), so the icon appears only for signed-in users on synced, non-sample rows.

export default function ShareFileButton({ ctx }: { ctx: FileRowContext }) {
  const { t } = useTranslation("plugins");
  const { user } = useAuth();
  const name = ctx.file.name;
  const isSample = isSampleFileName(name);
  const [synced, setSynced] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isSample || !user) return;
    let active = true;
    const load = () => {
      void getFileRecord(name).then((r) => active && setSynced(fileSyncStatus(r) === "synced"));
    };
    load();
    // The sibling sync toggle can flip this row to synced while we're mounted.
    const unsubscribe = subscribeFileSync(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [name, isSample, user]);

  if (isSample || !user || !synced) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 opacity-70 hover:opacity-100 text-muted-foreground"
        onClick={() => setOpen(true)}
        title={t("share.iconTitle")}
        aria-label={t("share.iconTitle")}
      >
        <Link2 className="w-3.5 h-3.5" />
      </Button>
      {open && <ShareSessionDialog fileName={name} open={open} onOpenChange={setOpen} />}
    </>
  );
}
