# `supabase/seeds/`

One-shot **content** scripts, run by hand against a Supabase project. These are
*not* migrations:

- `supabase/migrations/` is schema, applied automatically to every environment.
- `supabase/seeds/` is data you choose to load into a specific project (prod,
  beta, a preview branch) when you want it there.

Nothing here runs automatically. Paste a file into the Supabase SQL editor and
run it — that session connects as `postgres`, which bypasses RLS, so admin-only
insert policies are not in the way.

Every script must be **idempotent** (`on conflict … do nothing`, or an
equivalent guard) so a re-run is a no-op rather than a duplicate.

| File | What it does |
|---|---|
| `0001_backfill_release_posts.sql` | Backfills the `/updates` blog (plan 0012) with one post per shipped release, V1.0.0 (March 2026) through v3.1.1, reconstructed from `CHANGELOG.md` and the GitHub release pages. All tagged `web update`; `published_at` is each release's real publish time so the index reads in release order. |
