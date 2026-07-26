import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Globe, Newspaper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { splitLatestByTag, WEB_UPDATE_TAG } from "@/lib/blogPosts";
import type { PostSummary } from "@/plugins/cloud-sync/postsClient";

interface Latest {
  web: PostSummary | null;
  other: PostSummary | null;
}

/**
 * Landing-page "latest updates" teaser (plan 0012): two tap-through panels —
 * the newest published post tagged "web update" and the newest without that
 * tag — plus a button to the full /updates page. Renders nothing until the
 * posts load and disappears entirely when the fetch fails (offline landing
 * stays clean). Supabase is reached via dynamic import only: this component
 * sits on the eager landing graph.
 */
export function LatestUpdates() {
  const navigate = useNavigate();
  const { t } = useTranslation("landing");
  const [latest, setLatest] = useState<Latest | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { fetchLatestPostSummaries } = await import("@/plugins/cloud-sync/postsClient");
        const posts = await fetchLatestPostSummaries();
        if (cancelled) return;
        const { tagged, untagged } = splitLatestByTag(posts, WEB_UPDATE_TAG);
        setLatest({ web: tagged, other: untagged });
      } catch {
        // Offline or backend hiccup — the landing page just skips the section.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!latest || (!latest.web && !latest.other)) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Newspaper className="h-5 w-5 text-primary" />
        <h3 className="text-base font-semibold text-foreground">{t("updates.title")}</h3>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => navigate("/updates")}
        >
          {t("updates.viewAll")}
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {latest.web && (
          <UpdatePanel
            icon={<Globe className="h-4 w-4" />}
            label={t("updates.webUpdate")}
            post={latest.web}
            onOpen={() => navigate(`/updates/${latest.web!.slug}`)}
          />
        )}
        {latest.other && (
          <UpdatePanel
            icon={<Newspaper className="h-4 w-4" />}
            label={t("updates.news")}
            post={latest.other}
            onOpen={() => navigate(`/updates/${latest.other!.slug}`)}
          />
        )}
      </div>
    </div>
  );
}

function UpdatePanel({
  icon,
  label,
  post,
  onOpen,
}: {
  icon: React.ReactNode;
  label: string;
  post: PostSummary;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-start gap-4 rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-accent"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="mt-0.5 block truncate font-semibold text-foreground">{post.title}</span>
        {post.publishedAt && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {new Date(post.publishedAt).toLocaleDateString()}
          </span>
        )}
      </span>
    </button>
  );
}
