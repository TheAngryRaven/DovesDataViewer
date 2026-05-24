import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CloudUpload, CloudDownload, LogOut, WifiOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { pushAll, pullAll } from "./syncEngine";

type Busy = "push" | "pull" | "google" | null;

export default function CloudSyncPanel() {
  const { user, loading, logout, signInWithGoogle } = useAuth();
  const online = useOnlineStatus();
  const [busy, setBusy] = useState<Busy>(null);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking sign-in…
      </p>
    );
  }

  if (!user) {
    const handleGoogle = async () => {
      setBusy("google");
      const { error } = await signInWithGoogle();
      if (error) {
        setBusy(null);
        toast.error(error.message || "Google sign-in failed");
      }
    };
    return (
      <div className="space-y-3 max-w-sm">
        <p className="text-xs text-muted-foreground">
          Sign in to back up and sync your files, garage and notes across devices. Cloud Sync is optional — the app works fully offline without it.
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={handleGoogle} disabled={busy !== null || !online}>
            {busy === "google" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue with Google"}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button asChild variant="secondary"><Link to="/login?next=/">Sign in</Link></Button>
            <Button asChild><Link to="/register">Create account</Link></Button>
          </div>
        </div>
        {!online && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <WifiOff className="w-3.5 h-3.5" /> You're offline — sign-in needs a connection.
          </p>
        )}
      </div>
    );
  }

  const runPush = async () => {
    setBusy("push");
    try {
      const r = await pushAll(user.id);
      toast.success(`Pushed ${r.records} records and ${r.files} files to the cloud.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Push failed");
    } finally {
      setBusy(null);
    }
  };

  const runPull = async () => {
    if (!window.confirm("Pull merges your cloud copy into this device, overwriting any local records with the same name. Continue?")) return;
    setBusy("pull");
    try {
      const r = await pullAll(user.id);
      toast.success(`Pulled ${r.records} records and ${r.files} files. Reloading…`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pull failed");
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 max-w-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-foreground truncate">{user.email}</span>
        <Button variant="ghost" size="sm" onClick={logout} disabled={busy !== null}>
          <LogOut className="w-4 h-4 mr-1.5" /> Sign out
        </Button>
      </div>

      {!online && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <WifiOff className="w-3.5 h-3.5" /> You're offline — syncing is paused until you reconnect.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button onClick={runPush} disabled={busy !== null || !online}>
          {busy === "push" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CloudUpload className="w-4 h-4 mr-1.5" /> Push</>}
        </Button>
        <Button variant="secondary" onClick={runPull} disabled={busy !== null || !online}>
          {busy === "pull" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CloudDownload className="w-4 h-4 mr-1.5" /> Pull</>}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Push uploads your selected files (toggle them in the file manager) and your garage data. Pull brings your cloud copy down. Conflicts resolve in the direction you choose; nothing is deleted.
      </p>
    </div>
  );
}
