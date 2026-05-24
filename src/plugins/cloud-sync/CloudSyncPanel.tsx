import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CloudUpload, CloudDownload, LogOut, WifiOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { pushAll, pullAll } from "./syncEngine";

type Busy = "push" | "pull" | "login" | null;

export default function CloudSyncPanel() {
  const { user, loading, login, logout } = useAuth();
  const online = useOnlineStatus();
  const [busy, setBusy] = useState<Busy>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking sign-in…
      </p>
    );
  }

  if (!user) {
    const onSubmit = async (e: FormEvent) => {
      e.preventDefault();
      setBusy("login");
      const { error } = await login(email, password);
      setBusy(null);
      if (error) toast.error(error.message || "Sign-in failed");
    };
    return (
      <form onSubmit={onSubmit} className="space-y-3 max-w-sm">
        <p className="text-xs text-muted-foreground">
          Sign in to sync your files and garage across devices. More sign-in options coming soon.
        </p>
        <Input
          type="email"
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Button type="submit" disabled={busy === "login" || !online} className="w-full">
          {busy === "login" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
        </Button>
        {!online && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <WifiOff className="w-3.5 h-3.5" /> You're offline — sign-in needs a connection.
          </p>
        )}
      </form>
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
    if (!window.confirm("Pull merges your cloud copy into this device, overwriting any local records with the same name. Continue?")) {
      return;
    }
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
        Push uploads this device's files and garage data. Pull brings your cloud copy down. Conflicts resolve in the direction you choose; nothing is deleted.
      </p>
    </div>
  );
}
