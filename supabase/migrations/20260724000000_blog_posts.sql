-- Updates blog (plan 0011): admin-authored articles for the public /updates page.
--
-- Posts are markdown documents written from the admin portal. The public page
-- reads anonymously; RLS keeps drafts invisible until published. Excerpts are
-- derived client-side from the body (no excerpt column), and tag filtering is
-- client-side over the fetched list, so no GIN index on tags yet.

create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,        -- permanent SEO url segment
  title         text not null,
  body          text not null,               -- markdown source
  tags          text[] not null default '{}',
  ai_assisted   boolean not null default false,
  published     boolean not null default false,
  published_at  timestamptz,                 -- set client-side on first publish
  author_id     uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Listing query: published rows newest-first. Partial index keeps it tiny.
create index if not exists posts_published_at_idx
  on public.posts (published_at desc) where published;

alter table public.posts enable row level security;

drop policy if exists "Anyone reads published posts" on public.posts;
drop policy if exists "Admins read all posts"        on public.posts;
drop policy if exists "Admins insert posts"          on public.posts;
drop policy if exists "Admins update posts"          on public.posts;
drop policy if exists "Admins delete posts"          on public.posts;

create policy "Anyone reads published posts"
  on public.posts for select to anon, authenticated
  using (published);
create policy "Admins read all posts"
  on public.posts for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
create policy "Admins insert posts"
  on public.posts for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));
create policy "Admins update posts"
  on public.posts for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
create policy "Admins delete posts"
  on public.posts for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

notify pgrst, 'reload schema';
