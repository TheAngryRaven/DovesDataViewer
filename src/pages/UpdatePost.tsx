import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, FileQuestion, Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SettingsModal } from "@/components/SettingsModal";
import { MarkdownContent } from "@/components/MarkdownContent";
import { useSettings } from "@/hooks/useSettings";
import { useDocumentHead } from "@/hooks/useDocumentHead";
import { deriveExcerpt, type BlogPost } from "@/lib/blogPosts";
import { FEED_URL } from "@/lib/rssFeed";

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

type LoadState =
  | { status: "loading" }
  | { status: "notfound" }
  | { status: "error" }
  | { status: "ready"; post: BlogPost };

export default function UpdatePost() {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation(["updates", "common"]);
  const { settings, setSettings, toggleFieldDefault } = useSettings();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // No `t` dependency: the error is a state tag, translated at render time, so
  // a language switch doesn't refetch the post.
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const { fetchPostBySlug } = await import("@/plugins/cloud-sync/postsClient");
        const post = await fetchPostBySlug(slug ?? "");
        if (cancelled) return;
        setState(post ? { status: "ready", post } : { status: "notfound" });
      } catch (e) {
        // Backend text is never public-facing — log it, show the translation.
        console.error("Failed to load post:", e);
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const post = state.status === "ready" ? state.post : null;
  useDocumentHead({
    title: post ? `${post.title} — LapWing` : t("updates:metaTitle"),
    description: post ? deriveExcerpt(post.body, 160) : undefined,
    canonical: post ? `https://lapwingdata.com/updates/${post.slug}` : undefined,
    ogType: post ? "article" : undefined,
    publishedTime: post?.publishedAt ?? undefined,
    modifiedTime: post?.updatedAt ?? undefined,
    jsonLd: post
      ? {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          datePublished: post.publishedAt ?? undefined,
          dateModified: post.updatedAt,
          url: `https://lapwingdata.com/updates/${post.slug}`,
          keywords: post.tags.join(", ") || undefined,
          author: { "@type": "Organization", name: "LapWing" },
        }
      : undefined,
    feedUrl: FEED_URL,
    // Static hosting can't return a real 404, so keep the soft 404 out of the index.
    robots: state.status === "notfound" ? "noindex" : undefined,
  });

  const settingsButton = (
    <SettingsModal
      settings={settings}
      onSettingsChange={setSettings}
      onToggleFieldDefault={toggleFieldDefault}
      canHideSampleFiles
      triggerLabelBreakpoint="sm"
    />
  );

  return (
    <div className="min-h-screen bg-background flex flex-col safe-area-x">
      <SiteHeader
        settingsButton={settingsButton}
        enableCloud={enableCloud}
        onOpenProfile={() => navigate("/", { state: { openProfile: true } })}
        showSupportedFiles={false}
        showAbout={false}
      />

      <main className="flex-1 px-6 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <Link
            to="/updates"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("updates:backToUpdates")}
          </Link>

          {state.status === "loading" && (
            <p className="text-sm text-muted-foreground">{t("updates:loading")}</p>
          )}
          {state.status === "error" && (
            <p className="text-sm text-destructive">{t("updates:loadFailed")}</p>
          )}
          {state.status === "notfound" && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
              <FileQuestion className="h-10 w-10 opacity-40" />
              <p className="text-base font-medium text-foreground">{t("updates:notFoundTitle")}</p>
              <p className="text-sm">{t("updates:notFoundBody")}</p>
            </div>
          )}

          {post && (
            <article className="space-y-4">
              <header className="space-y-2">
                <h1 className="text-3xl font-bold text-foreground">{post.title}</h1>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {post.publishedAt && <span>{new Date(post.publishedAt).toLocaleDateString()}</span>}
                  {post.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
                      {tag}
                    </span>
                  ))}
                  {post.aiAssisted && (
                    <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]">
                      <Sparkles className="h-3 w-3" /> {t("updates:aiAssisted")}
                    </span>
                  )}
                </div>
              </header>
              <MarkdownContent source={post.body} />
            </article>
          )}
        </div>
      </main>
    </div>
  );
}
