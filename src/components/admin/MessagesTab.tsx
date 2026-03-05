import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Mail, MailOpen, ArrowLeft } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { MESSAGE_CATEGORIES } from "@/components/ContactDialog";

interface Message {
  id: string;
  category: string;
  email: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
  submitted_by_ip: string | null;
}

type FilterMode = "all" | "unread" | "read";

const categoryColors: Record<string, string> = {
  "Comment": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "Feature Request": "bg-green-500/20 text-green-400 border-green-500/30",
  "Complaint": "bg-red-500/20 text-red-400 border-red-500/30",
  "Bug Report": "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

export function MessagesTab({ onUnreadCount }: { onUnreadCount?: (count: number) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    // Need to cast since messages table isn't in generated types yet
    const { data, error } = await (supabase as any)
      .from("messages")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Error loading messages", description: error.message, variant: "destructive" });
    } else {
      setMessages(data || []);
      const unread = (data || []).filter((m: Message) => !m.is_read).length;
      onUnreadCount?.(unread);
    }
    setLoading(false);
  }, [onUnreadCount]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  const markAsRead = async (id: string) => {
    await (supabase as any).from("messages").update({ is_read: true }).eq("id", id);
    setMessages(prev => prev.map(m => m.id === id ? { ...m, is_read: true } : m));
    const newUnread = messages.filter(m => !m.is_read && m.id !== id).length;
    onUnreadCount?.(newUnread);
  };

  const deleteMessage = async (id: string) => {
    const { error } = await (supabase as any).from("messages").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setMessages(prev => prev.filter(m => m.id !== id));
      if (expandedId === id) setExpandedId(null);
      const remaining = messages.filter(m => m.id !== id);
      onUnreadCount?.(remaining.filter(m => !m.is_read).length);
    }
  };

  const handleExpand = (msg: Message) => {
    if (expandedId === msg.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(msg.id);
    if (!msg.is_read) markAsRead(msg.id);
  };

  const filtered = messages.filter(m => {
    if (filter === "unread") return !m.is_read;
    if (filter === "read") return m.is_read;
    return true;
  });

  if (loading) return <p className="text-muted-foreground py-4">Loading messages…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(["all", "unread", "read"] as FilterMode[]).map(f => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "unread" ? "Unread" : "Read"}
            {f === "unread" && (
              <span className="ml-1 text-xs">({messages.filter(m => !m.is_read).length})</span>
            )}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={fetchMessages} className="ml-auto">Refresh</Button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">No messages</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(msg => (
            <div key={msg.id} className={`border rounded-lg transition-colors ${!msg.is_read ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
              <button
                onClick={() => handleExpand(msg)}
                className="w-full text-left px-4 py-3 flex items-center gap-3"
              >
                {msg.is_read
                  ? <MailOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                  : <Mail className="w-4 h-4 text-primary shrink-0" />
                }
                <Badge variant="outline" className={categoryColors[msg.category] || ""}>
                  {msg.category}
                </Badge>
                <span className="text-sm truncate flex-1">
                  {msg.message.length > 80 ? msg.message.slice(0, 80) + "…" : msg.message}
                </span>
                {msg.email && <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">{msg.email}</span>}
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(msg.created_at).toLocaleDateString()}
                </span>
              </button>

              {expandedId === msg.id && (
                <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                  <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {msg.email && <span>Email: {msg.email}</span>}
                    <span>IP: {msg.submitted_by_ip || "unknown"}</span>
                    <span>{new Date(msg.created_at).toLocaleString()}</span>
                    <Button size="sm" variant="destructive" className="ml-auto h-7" onClick={() => deleteMessage(msg.id)}>
                      <Trash2 className="w-3 h-3 mr-1" /> Delete
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
