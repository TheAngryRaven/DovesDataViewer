import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Newspaper, Rss, Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SettingsModal } from "@/components/SettingsModal";
import { BackToHome } from "@/components/BackToHome";
import { useSettings } from "@/hooks/useSettings";
import { useDocumentHead } from "@/hooks/useDocumentHead";
import { deriveExcerpt, collectTags } from "@/lib/blogPosts";
import type { PostListItem } from "@/plugins/cloud-sync/postsClient";
import { FEED_URL } from "@/lib/rssFeed";

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

export default function Updates() {
  const navigate = useNavigate();
  const { t } = useTranslation(["updates", "common"]);
  const { settings, setSettings, toggleFieldDefault } = useSettings();
  const [posts, setPosts] = useState<PostListItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useDocumentHead({
    title: t("updates:metaTitle"),
    description: t("updates:metaDescription"),
    canonical: "https://lapwingdata.com/updates",
    feedUrl: FEED_URL,
  });

  // No `t` dependency: the failure is rendered as a flag so switching language
  // re-renders the message instead of re-running the fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { fetchPublishedPostList } = await import("@/plugins/cloud-sync/postsClient");
        const published = await fetchPublishedPostList();
        if (!cancelled) setPosts(published);
      } catch (e) {
        // Backend text is never public-facing — log it, show the translation.
        console.error("Failed to load updates:", e);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tags = useMemo(() => (posts ? collectTags(posts) : []), [posts]);
  const visible = useMemo(
    () => (posts ?? []).filter((p) => !activeTag || p.tags.includes(activeTag)),
    [posts, activeTag],
  );

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
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <BackToHome />

          <div className="flex items-center gap-2">
            <Newspaper className="h-5 w-5 text-primary" />
            <h2 className="text-2xl font-bold text-foreground">{t("updates:pageTitle")}</h2>
            <a
              href={FEED_URL}
              target="_blank"
              rel="noopener noreferrer"
              title={t("updates:subscribeRss")}
              className="ml-auto flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
            >
              <Rss className="h-3.5 w-3.5" />
              {t("updates:subscribeRss")}
            </a>
          </div>
          <p className="text-sm text-muted-foreground">{t("updates:pageSubtitle")}</p>

          {failed && <p className="text-sm text-destructive">{t("updates:loadFailed")}</p>}
          {!posts && !failed && <p className="text-sm text-muted-foreground">{t("updates:loading")}</p>}

          {posts && tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <TagPill label={t("updates:allTag")} active={activeTag === null} onClick={() => setActiveTag(null)} />
              {tags.map((tag) => (
                <TagPill
                  key={tag}
                  label={tag}
                  active={activeTag === tag}
                  onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                />
              ))}
            </div>
          )}

          {posts && posts.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
              <Newspaper className="h-10 w-10 opacity-40" />
              <p className="text-sm">{t("updates:empty")}</p>
            </div>
          )}

          <div className="space-y-4">
            {visible.map((post) => (
              <PostCard key={post.id} post={post} onTagClick={setActiveTag} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function TagPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-primary/10"
      }`}
    >
      {label}
    </button>
  );
}

function PostCard({ post, onTagClick }: { post: PostListItem; onTagClick: (tag: string) => void }) {
  const { t } = useTranslation("updates");
  const excerpt = deriveExcerpt(post.bodyPreview);
  return (
    <article className="rounded-lg border border-border p-4 transition-colors hover:border-primary/50 hover:bg-primary/5">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/updates/${post.slug}`} className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground hover:text-primary">{post.title}</h3>
        </Link>
        {post.aiAssisted && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            <Sparkles className="h-3 w-3" /> {t("aiAssisted")}
          </span>
        )}
      </div>
      {post.publishedAt && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {new Date(post.publishedAt).toLocaleDateString()}
        </p>
      )}
      {excerpt && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{excerpt}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {post.tags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onTagClick(tag)}
            className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-primary/10"
          >
            {tag}
          </button>
        ))}
        <Link to={`/updates/${post.slug}`} className="ml-auto text-xs font-medium text-primary hover:underline">
          {t("readMore")} →
        </Link>
      </div>
    </article>
  );
}
