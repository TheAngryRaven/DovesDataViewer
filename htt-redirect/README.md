# htt-redirect

A minimal Cloudflare Worker that permanently redirects the **old domain** —
**https://hackthetrack.net** (and `www.`) — to **https://lapwingdata.com**.

## Why this exists

HackTheTrack was renamed to **LapWing** and moved to `lapwingdata.com`. The old
site showed a migration banner until its announced shutdown date
(**July 20, 2026**); this Worker is the shutdown. Every request 301s to the
same path + query on the new domain, so old deep links keep working.

### The service-worker kill-switch

The old site was an **offline-first PWA**. Returning visitors have a service
worker that serves the cached app shell without touching the network — a plain
redirect would never reach them. And a service-worker *update* fetch that gets
redirected simply **fails**, leaving the stale worker installed forever.

So two paths are **not** redirected: `/service-worker.js` and `/sw.js` (the two
SW URLs the old app ever registered) return a self-destructing kill-switch
script (the same one as the app's `public/sw.js`). On the client's next online
visit, the browser's SW update check picks it up; it clears every cache,
reloads open tabs (which then hit the redirect), and unregisters itself.

## Prerequisites

- The zone **hackthetrack.net** is managed in this Cloudflare account.
- Both hostnames (`hackthetrack.net`, `www.hackthetrack.net`) are **detached
  from whatever Worker served the old site** — a custom domain can only bind to
  one Worker, and a non-interactive (CI) deploy fails on the conflict instead
  of prompting. Remove the old attachment in the dashboard first.
- Node.js installed locally (for manual deploys).

## Deploy

### Automatic (CI)

The `.github/workflows/deploy-htt-redirect.yml` workflow deploys this Worker
on every push to **`main`** that touches `htt-redirect/**` (and on demand via
*workflow_dispatch*). PRs that touch it get a `wrangler deploy --dry-run`
validation instead. The deploy job reuses the same two repo secrets as
`beta-proxy`:

| Secret | What |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | A token with **Edit Cloudflare Workers** on the account |
| `CLOUDFLARE_ACCOUNT_ID` | The account that owns the `hackthetrack.net` zone |

The wrangler version is pinned in the workflow (`WRANGLER_VERSION`) so CI runs
are reproducible — there is no committed lockfile here.

### Manual

```bash
cd htt-redirect
npm install

# Authenticate (opens a browser; one-time per machine)
npx wrangler login

# Validate config + bundle without deploying
npm run dry-run

# Deploy for real
npm run deploy
```

> **Note:** this project lives inside the `DovesDataViewer` repo, which has its
> own root `wrangler.jsonc`. Wrangler's config discovery walks *up* the tree and
> would otherwise pick up that parent config, so the npm scripts (and any direct
> invocation) must pass `--config ./wrangler.toml`.

The `custom_domain` routes in [`wrangler.toml`](wrangler.toml) make Cloudflare
**automatically provision the DNS records and TLS certificates** for both
hostnames on first deploy. **Do not create any DNS records by hand** — doing so
will conflict with the custom-domain binding.
