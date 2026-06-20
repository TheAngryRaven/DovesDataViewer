# beta-proxy

A minimal Cloudflare Worker that reverse-proxies **https://beta.lapwingdata.com**
to the stable `beta` branch preview of the `dovesdataviewer` Worker.

## Why this exists

The `dovesdataviewer` Worker has non-production branch builds enabled. Pushes to
the `beta` branch publish a **stable Branch Preview URL**:

```
https://beta-dovesdataviewer.perchwerks.workers.dev
```

that always serves the latest `beta` push. Cloudflare **custom domains cannot be
attached directly to a preview URL**, so this thin proxy Worker owns
`beta.lapwingdata.com` and forwards every request to the preview URL, returning
the upstream response unchanged (it also rewrites the `Location` header on 3xx
redirects so the preview hostname never leaks to the client).

The upstream host is a single top-level constant (`UPSTREAM_HOST`) in
[`src/index.ts`](src/index.ts) — change it there if the target ever moves. (It
stays on `perchwerks.workers.dev` because the preview URL is derived from the
Worker name + the account's workers.dev subdomain, which the new public domain
doesn't change.)

## Prerequisites

- The zone **lapwingdata.com** is already managed in this Cloudflare account.
- Node.js installed locally.

## Deploy

```bash
cd beta-proxy
npm install

# Authenticate (opens a browser; one-time per machine)
npx wrangler login

# Validate config + bundle without deploying
npm run dry-run

# Deploy for real
npm run deploy
```

> **Note:** this project lives inside the `dovesdataviewer` repo, which has its
> own root `wrangler.jsonc`. Wrangler's config discovery walks *up* the tree and
> would otherwise pick up that parent config, so the npm scripts (and any direct
> invocation) must pass `--config ./wrangler.toml`. The `npm run deploy` /
> `npm run dry-run` scripts already do this — if you call wrangler directly, run
> `npx wrangler deploy --config ./wrangler.toml`.

The `custom_domain` route in [`wrangler.toml`](wrangler.toml) makes Cloudflare
**automatically provision the DNS record and TLS certificate** for
`beta.lapwingdata.com` on first deploy. **Do not create any DNS records by hand** —
doing so will conflict with the custom-domain binding.

## ⚠️ Cloudflare Access must be OFF on the upstream preview URL

This proxy makes a server-side `fetch()` to
`beta-dovesdataviewer.perchwerks.workers.dev`. If **Cloudflare Access** (Zero
Trust) is enabled on that preview hostname (or on the `*.workers.dev` route),
the proxy's `fetch` will be redirected to an Access login wall and your users
will see a Cloudflare login page instead of the app.

**Keep Cloudflare Access disabled on the upstream preview URL** for this proxy
to work. If you need to gate `beta.lapwingdata.com`, add Access on *this* proxy's
custom domain instead, not on the upstream.
