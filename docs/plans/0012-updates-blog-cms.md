# 0012 — Updates blog / minimal CMS (`/updates`, `/updates/:slug`)

**Status:** Shipped (initial version).

## Context

The maintainer wants to publish articles about LapWing's processes (features,
engineering write-ups, release deep-dives) so search engines and LLM crawlers
pick them up over time. Requirements: a public `/updates` index (title +
~a-paragraph excerpt per post), `/updates/:slug` per-post pages with
SEO-friendly WordPress-style slugs, basic text styling (headers/bold/links +
image embeds by external URL, no uploads), authoring from the existing
`/admin` portal, a super-basic tag system (type new tags or reuse previous
ones; public index filters by tag), and a per-post "AI-assisted" flag.

## Decisions

- **Storage: Supabase `public.posts` table.** Posts are admin-authored cloud
  content, so this lives with the other cloud features (Golden Rule 1's
  admin/cloud exception). Routes gate behind `VITE_ENABLE_CLOUD` exactly like
  `/leaderboards` and `/driver/:username`. No edge function — RLS suffices:
  anon/authenticated read `published` rows only, plus admin-only
  select-all/insert/update/delete via `public.has_role(auth.uid(), 'admin')`
  (same archetype as `leaderboard_entries`).
- **Format: Markdown**, authored in a plain textarea with a live preview.
  Rendered with `react-markdown` + `remark-gfm`. react-markdown never renders
  raw HTML, so no sanitizer is needed even as defense-in-depth against a
  compromised admin account. Images are standard `![alt](https://…)` — external
  URLs only, zero upload infrastructure.
- **Excerpts are derived, not stored.** `deriveExcerpt(markdown, maxChars)` in
  `lib/blogPosts.ts` strips markdown and takes the first real paragraph; the
  `maxChars` knob is the "fine-tune later" lever. No excerpt column to keep in
  sync.
- **Slugs**: `slugify(title)` (lowercase, diacritics stripped, hyphen-joined,
  ~80-char cap) auto-fills the slug field until it's hand-edited; DB `unique`
  constraint is the backstop. Slugs are permanent URLs — the admin UI shows the
  slug so it can be set deliberately before publishing.
- **"AI-assisted" is a `Switch`** (no Checkbox primitive exists in `ui/`;
  Switch is the established admin toggle). Shown as a badge on public pages.
- **Tag filtering is client-side** over the fetched published list — the post
  count will stay small for a long time. No tags GIN index yet; add one if
  server-side tag queries ever become necessary.
- **Bundle discipline**: public pages dynamic-import `postsClient` at the call
  site (vendor-supabase stays off the eager graph); react-markdown lives in a
  new `vendor-markdown` manual chunk reachable only from lazy pages.
- **Post bodies are English-only** (like the legal pages); only page chrome is
  translated (`updates` namespace, lazy-loaded like `leaderboard`/`driver`).

## Shape

| Piece | File |
|---|---|
| Migration | `supabase/migrations/20260724000000_blog_posts.sql` |
| Pure helpers + types | `src/lib/blogPosts.ts` (+ `.test.ts`) |
| Data access | `src/plugins/cloud-sync/postsClient.ts` (leaderboardClient pattern, `untyped.from("posts")` — generated types lag schema) |
| Shared renderer | `src/components/MarkdownContent.tsx` (`prose dark:prose-invert` + token overrides; `@tailwindcss/typography` registered in `tailwind.config.ts`) |
| Public pages | `src/pages/Updates.tsx`, `src/pages/UpdatePost.tsx` (DriverProfile load-state model) |
| Admin | `src/components/admin/UpdatesTab.tsx` (TracksTab CRUD skeleton, inline editor, Write/Preview toggle) |
| SEO | `useDocumentHead` extended with `ogType` / `publishedTime` / `modifiedTime` / `jsonLd` (JSON-LD `BlogPosting`) / `feedUrl` (RSS autodiscovery); `public/sitemap.xml` + `public/llms.txt` list `/updates` |
| RSS | `supabase/functions/rss-feed` renders the RSS 2.0 feed server-side (readers can't run the SPA; hosting is static-only). Anon-key read of published posts, 15-min cache. `lib/rssFeed.ts` builds the per-backend URL; `/updates` shows a subscribe link and both pages emit the autodiscovery `<link>`. The function duplicates a trimmed `deriveExcerpt` (Deno can't import from `src/`) — keep them in step |

`published_at` is set client-side the first time a post is published (kept on
later unpublish/republish so ordering is stable). `updated_at` is set by the
client on every update (same convention as `updateEngineClass`).

## Deferred / future work

- **Per-post sitemap entries** — `sitemap.xml` is a static hand-maintained
  file and posts are runtime DB data. Would need a Worker script or a
  build/deploy step that queries the DB.
- **Per-post OG cards for social scrapers** — Twitter/Slack/Discord/Facebook
  don't execute JS, and `wrangler.jsonc` is a static-assets-only Worker with
  SPA fallback, so every deep link serves the generic `index.html` tags. Fixing
  this means adding a Worker `main` script (edge-render meta tags for
  `/updates/*`) or a prerender step. Google Search and JS-executing LLM
  crawlers are served today by `useDocumentHead` + JSON-LD + `llms.txt`.
- **Server-side tag queries / GIN index** — only if the client-side filter
  stops scaling.
- **Unknown slugs return HTTP 200** (SPA fallback) with an in-page not-found
  card — a soft-404 for crawlers. Acceptable at this scale.
