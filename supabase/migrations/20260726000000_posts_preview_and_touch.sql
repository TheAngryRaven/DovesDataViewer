-- Updates blog follow-ups (plan 0012).
--
-- 1. body_preview: the /updates index only needs an excerpt, but it was
--    selecting the full markdown body of every published post — a payload that
--    grows without bound as the blog fills up. A stored generated column gives
--    the listing a small, fixed-cost column to derive excerpts from while the
--    article page still reads the real body. 2000 chars is far more than
--    deriveExcerpt's 280-char output needs, with headroom for posts that open
--    with headings, images, or a code fence before the first paragraph.
--
-- 2. updated_at was maintained client-side, so a write that didn't go through
--    the admin UI left it stale — and it feeds article:modified_time and the
--    JSON-LD dateModified. Use the same trigger every other table uses.

alter table public.posts
  add column if not exists body_preview text
  generated always as (left(body, 2000)) stored;

drop trigger if exists update_posts_updated_at on public.posts;
create trigger update_posts_updated_at
  before update on public.posts
  for each row execute function public.update_updated_at_column();

notify pgrst, 'reload schema';
