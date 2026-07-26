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
| `0001_backfill_release_posts.sql` | Backfills the `/updates` blog (plan 0012) with one post per shipped **web app** release, V1.0.0 (March 2026) through v3.1.1, reconstructed from this repo's `CHANGELOG.md` and its GitHub release pages. 23 posts, all tagged `web update`. |
| `0002_backfill_firmware_posts.sql` | Same, for the **Fledgling firmware** ([DovesDataLogger](https://github.com/TheAngryRaven/DovesDataLogger)), v1.0.0 through v3.0.1, from that repo's changelog and releases. 9 posts, each tagged `hardware update` **and** `fledgling`. |

Both use each release's real GitHub publish timestamp as `published_at`, so the
index reads in true release order and the two streams interleave by date.

Only `web update` is `WEB_UPDATE_TAG` (`src/lib/blogPosts.ts`), so the landing
page's first "Latest updates" panel shows the newest web-app release and the
second shows the newest firmware post — they do not compete for the same slot.
Every SQL statement here uses plain single-quoted literals; do **not**
reintroduce dollar-quoted strings, which the Supabase SQL editor mis-parses.
