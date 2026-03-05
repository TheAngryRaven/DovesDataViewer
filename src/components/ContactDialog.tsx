import { useState } from "react";
import { Mail } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

export const MESSAGE_CATEGORIES = ["Comment", "Feature Request", "Complaint", "Bug Report"] as const;

export function ContactDialog({ variant = "footer" }: { variant?: "header" | "footer" }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!category || !message.trim()) {
      toast({ title: "Missing fields", description: "Please select a category and enter a message.", variant: "destructive" });
      return;
    }
    if (message.trim().length > 2000) {
      toast({ title: "Message too long", description: "Max 2000 characters.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/submit-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, email: email.trim() || null, message: message.trim() }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        toast({ title: "Error", description: data.error || "Something went wrong.", variant: "destructive" });
        return;
      }

      toast({ title: "Message sent!", description: "Thanks for your feedback." });
      setCategory("");
      setEmail("");
      setMessage("");
      setOpen(false);
    } catch {
      toast({ title: "Error", description: "Could not send message. Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "header" ? (
          <Button variant="outline" size="sm" className="gap-2">
            <Mail className="w-4 h-4" />
            <span className="hidden sm:inline">Contact</span>
          </Button>
        ) : (
          <button className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
            <Mail className="w-3 h-3" />
            Contact
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Contact Us</DialogTitle>
          <DialogDescription>Send us a message — we'll read every one.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Category *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
              <SelectContent>
                {MESSAGE_CATEGORIES.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Email <span className="text-muted-foreground text-xs">(optional, for a reply)</span></Label>
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              maxLength={255}
            />
          </div>
          <div className="space-y-2">
            <Label>Message *</Label>
            <Textarea
              placeholder="What's on your mind?"
              value={message}
              onChange={e => setMessage(e.target.value)}
              maxLength={2000}
              rows={5}
            />
            <p className="text-xs text-muted-foreground text-right">{message.length}/2000</p>
          </div>
          <Button onClick={handleSubmit} disabled={submitting || !category || !message.trim()} className="w-full">
            {submitting ? "Sending…" : "Send Message"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
