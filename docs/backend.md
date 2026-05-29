# Backend Reference — Supabase / Server-Side

> Extracted from `CLAUDE.md` to keep that file focused on the offline-first core.
> **Per Golden Rule #1, the core app needs none of this** — these subsystems are
> the accepted online exceptions (cloud sync, billing, account data rights).
> Read this before working on the `src/plugins/cloud-sync/` plugin, billing
> (`lib/billing*.ts`, `PricingCards`, `PlanChooser`), GDPR/account flows, or
> anything under `supabase/` (migrations + edge functions). Operator setup
> (Stripe Products/Prices, secrets, `pg_cron`) lives in `README.md`.

---

## Cloud Sync (`src/plugins/cloud-sync/`)

Optional per-user backup/sync of the IndexedDB stores (see CLAUDE.md → IndexedDB
Storage) to Supabase. Built as a first-party plugin (Labs + Profile panels),
online-only (accepted offline-first exception). Manual push/pull remains
(`CloudSyncPanel`), but the **document tier now auto-syncs**, and is
**offline-aware + conflict-safe**: storage modules emit `garageEvents` on
write/delete, and `autoSync.ts` (started in `setup`, dynamically imported to stay
off the initial bundle) debounces and incrementally **upserts / deletes** the one
changed record while signed in. So edits back up automatically and **deletes
propagate everywhere** — the Karts/Setups delete UI shows a loud "deletes from
every device + the cloud" warning when signed in.

**Conflict resolution** (`merge.ts`, pure + tested): every garage record carries an
`updatedAt` (stamped in each storage `save*`; the sync write path `writeOne` keeps
the cloud value). `decideSync` is **pending-wins + last-write-wins**: a change made
offline or whose push failed is recorded in a persistent **pending set**
(`pendingSync.ts`, in the plugin KV) and, on reconnect/sign-in, flushed first as
**priority-1** (replacing the cloud copy); everything else merges by newest
`updatedAt` (the record's logical edit time — never the server row time).
`reconcileDocs` does the two-way merge (pull cloud-newer, push local-newer/-only),
skipping pending keys. Its push (and `pushAll`'s) goes through `pushDocRows`: one
optimistic batch, falling back to per-record upserts if the server quota trigger
rejects the batch — so an over-limit local set still **partial-syncs** everything
that fits and reports a `skipped` count (surfaced as a toast) rather than failing
wholesale. `autoSync` tracks `navigator.onLine` + window online/offline events;
the Profile-tab `StoragePanel` flags offline state + the pending count.

**Storage types** (`storageTypes.ts`, enforced server-side) — distinct from
future *subscription tiers*: **documents** = all structured stores (5 MB, free,
auto-synced) and **logs** = file blobs (20 MB, opt-in). Limits live in the
`quota_limits` table (one source of truth for the enforcing trigger + the client
meter); `sync_storage_usage()` returns per-type usage for the Profile-tab meters.
Client checks are advisory — the DB trigger is the real gate.

Backend (migrations `..._cloud_sync.sql`, `..._storage_quotas.sql`):

| Object | Type | Notes |
|--------|------|-------|
| `sync_records` | table | One jsonb document per record: `(user_id, store, record_key, data, updated_at)`, unique on `(user_id, store, record_key)`. RLS: `auth.uid() = user_id`. `store`/`record_key` mirror the IndexedDB store name + key path. |
| `user-files` | Storage bucket | Private. Raw session blobs at `{user_id}/{encodeURIComponent(name)}`. RLS scopes objects to the owner's folder. |
| `quota_limits` | table | `(storage_type, max_bytes)` seeded `documents`=5 MB, `logs`=20 MB. Legacy baseline/fallback once tiers exist (see below). |
| `enforce_sync_quota` | trigger | BEFORE INSERT/UPDATE on `sync_records`: rejects writes that push a storage type over the **caller's tier** limit (`tier_limit()`), falling back to `quota_limits` (`quota_exceeded`). |
| `sync_storage_usage()` | RPC | Per-type `(used_bytes, limit_bytes)` for the caller — `limit_bytes` reflects the caller's tier. |
| `profiles` | table | `(user_id PK→auth.users, display_name unique, …)`. RLS: authenticated read-all, update/insert own. Display name is unique but **not** a key — user-editable. |
| `handle_new_user` | trigger | On `auth.users` insert: creates a profile, using the sign-up `display_name` or a generated silly name (`SpeedyRac3r-546`). `unique_display_name()` auto-suffixes a taken name at creation; user edits get an explicit "taken" error instead. |

Synced stores (`syncStores.ts` — pure, unit-tested): `metadata`, `karts`,
`setups`, `notes`, `graph-prefs`, `vehicle-types`, `setup-templates`, `tracks`
(jsonb docs) + `files` (blobs). Video stores are intentionally excluded (size).
`vehicle-types`/`setup-templates` ride along because setups are template-driven.
Most stores are IndexedDB; **`tracks` is localStorage** (only *user* tracks/courses,
never the built-in public ones), reached through `storeAccessors.ts` — a per-store
read/get/put seam so the engine isn't hard-wired to IndexedDB. Track edits stamp
`updatedAt` + emit `garageEvents`, so they ride the same auto-sync + delete
propagation + pending-wins/LWW merge as setups.

Cloud **log deletion** happens two ways. (1) On the Profile tab (`CloudLogsPanel`):
`listCloudFiles` (with `uploadedAt`) lists the user's cloud log files;
`deleteCloudFile(userId, name)` removes the blob + its `sync_records` index row
(cloud-only — other devices keep their downloaded copy), and the panel clears the
per-file selection + optionally deletes the local copy on this device. (2) On
**local delete** of a synced log: the `FileDeleteConfirm` mount (`FileDeleteToggle`)
adds an opt-in *"also delete the cloud copy"* switch (off by default — the cloud
copy is a backup). When ticked it calls `deleteCloudFile` (online) or queues a
`{store:"files", type:"delete"}` **pending change** (offline / on failure) that
`autoSync.pushOne` flushes via `deleteCloudFile` on reconnect.

**Orphan-safety:** `uploadBlob` writes the blob then the index row; if the index
write is rejected (e.g. the server quota trigger), it **rolls the blob back** so
it can't orphan in the bucket. `cleanupOrphanBlobs(userId)` (run once per user when
`CloudLogsPanel` opens) reclaims any pre-existing orphans — bucket objects whose
decoded name has no index row (`orphanedObjectNames`, pure + tested).

Files are **opt-in per file** (`fileSync.ts`): a `FileRow` mount adds a toggle to
each file-manager row (`off` → `pending` → `synced`), and the selection set lives
in the plugin's own KV store (`getPluginStore("cloud-sync")`). `pushAll` uploads
all garage docs but only the *selected* files; `pushFile` handles a single
toggle. A `FileManagerSection` mount (`CloudFilesSection`) lists **all** cloud
files — ones already on this device are marked present, others get a per-file
pull; pulling persists via `ctx.onSaveFile` (which refreshes the list). A
dedicated Cloud *tab* (a new garage-tab mount slot), `modified` detection, and a
"sync all" affordance remain follow-ups.

After a migration, Lovable regenerates `integrations/supabase/types.ts`. Until
then `cloudClient.ts` accesses the new table/bucket through a narrowly-typed
escape hatch confined to that one module.

> **Lap-snapshot sync** uses its own dedicated `lap_snapshots` table with a
> per-tier COUNT quota (not byte document storage) — see CLAUDE.md → Lap
> Snapshots for the client model and the snapshot-specific sync rules.

---

## Subscriptions / Stripe (`..._stripe_subscriptions.sql`, `..._subscription_grace_trim.sql` + 4 edge functions)

Paid tiers scale the cloud-sync **logs** quota (`free` 20 MB → `plus` $1 500 MB
→ `premium` $3 1 GB → `pro` $10 1 GB; docs stay 5 MB). `premium` matches `pro`'s
storage but carries no AI credits. Each paid tier bills **monthly or annual**.
Tiers are **data**, not code (numbers are provisional):

| Object | Type | Notes |
|--------|------|-------|
| `subscription_tiers` | table | One row per plan: `(tier PK, label, price_cents, logs_bytes, doc_bytes, ai_credits, stripe_price_id, sort_order)`. Authenticated read-all. Change a limit = UPDATE here. (`stripe_price_id` is a legacy fallback only — prices now resolve by lookup_key, see below.) |
| `user_subscriptions` | table | `(user_id PK→auth.users, tier→subscription_tiers, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, billing_interval, grace_until, logs_trimmed_at, updated_at)`. RLS: owner **read-only** — only the service role (webhook) writes, so no one can self-grant a tier. |
| `user_tier(uuid)` | fn (SECURITY DEFINER) | Effective tier: the subscription tier when `status in (active, trialing, past_due)`, else `free`. |
| `tier_limit(uuid, type)` | fn (SECURITY DEFINER) | Byte limit for a user + storage type from their tier; falls back to `free`, then `quota_limits`. Used by the quota trigger + usage RPC. |
| `encode_uri_component(text)` | fn | SQL parity with JS `encodeURIComponent`, so the trim job can address the right `user-files` bucket object (`{user_id}/{encoded name}`). |
| `trim_expired_logs()` | fn (SECURITY DEFINER) | For users past their `grace_until`, deletes synced **log** files newest-first (index row + bucket object) down to the free `logs_bytes`. Scheduled daily via `pg_cron` (guarded; enable the extension or run externally). Not granted to `authenticated`. |

**Prices via lookup_key (no Price ids in code):** each (tier × interval) has a
Stripe Price tagged with a lookup_key `${tier}_${interval}` (`plus_monthly`,
`plus_annual`, `premium_monthly`, …). Checkout and the catalogue resolve prices
live by lookup_key, so the Stripe dashboard is the single source of truth.

**Coming-soon tiers:** `COMING_SOON_TIERS` in `lib/billing.ts` (currently `pro`,
the AI plan) lists tiers that exist but aren't self-service purchasable yet —
shown as "Coming soon", excluded from `PlanChooser`, no Upgrade button, and
rejected by `create-checkout-session` (mirror the set there). They can still be
**comped** by creating the subscription directly in Stripe (set the
subscription's `metadata.user_id`, or change an existing customer's price); the
webhook grants whatever tier the price's lookup_key maps to.

**Cancellation grace:** a cancelled sub ends at the period boundary (Stripe
`customer.subscription.deleted`), dropping to free limits immediately (via
`user_tier`), but `grace_until = period_end + 60 days` keeps the user's logs so
they can re-subscribe/download. After grace, `trim_expired_logs()` trims them.

Edge functions (all `verify_jwt = false`; checkout/portal verify the JWT
manually like the rest of the repo, the webhook verifies the Stripe signature):

- `stripe-prices` — **public**, no auth. Reports `{ configured, prices[] }`:
  `configured:false` when `STRIPE_SECRET_KEY` is absent (→ client free-only
  failback), else live monthly/annual prices fetched by lookup_key.
- `create-checkout-session` — auth user + `{ tier, interval }` → ensure Stripe
  customer (persisted on `user_subscriptions`) → resolve Price by lookup_key →
  Checkout Session (subscription mode) → returns the hosted URL.
- `stripe-webhook` — **the only writer of entitlements**. Verifies the signature
  (`STRIPE_WEBHOOK_SECRET`), then on `checkout.session.completed` /
  `customer.subscription.created|updated|deleted` upserts `user_subscriptions`
  (tier + interval resolved from the Price's lookup_key; sets
  `cancel_at_period_end`; on cancellation sets `grace_until`; `deleted` → `free`)
  via the service role.
- `create-portal-session` — returns a Stripe Billing Portal URL for
  manage/upgrade/downgrade/cancel (no in-app billing UI).

Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

**Client wiring** (core, not the cloud-sync plugin — billing is account-level and
PricingCards renders even with cloud disabled): `lib/billing.ts` is the pure,
unit-tested layer (`isActiveStatus`/`effectiveTier`/`isPaidTier`/`pricingCta`,
plus `lookupKey`/`tiersWithPrices`/`paidTiersVisible`/`priceFor`/`formatPrice` +
row/price shapes); `lib/billingClient.ts` is the Supabase I/O (`fetchTiers`,
`fetchMySubscription`, `fetchStripeConfig`, `createCheckout(tier, interval)`,
`createPortal`), through the same untyped escape hatch as `cloudClient.ts`.
`hooks/useSubscription.ts` reads the tier catalogue + the user's subscription;
`hooks/useStripePrices.ts` reads the live price catalogue (online, never throws).
`PricingCards` has a **monthly/annual toggle**, shows live **Upgrade** /
**Current plan** actions, and — the **failback** — hides the paid tiers entirely
when `paidTiersVisible(config)` is false (only Guest + Free cards). `PlanChooser`
(sign-up) picks tier + interval; a paid choice stashes a `lib/pendingCheckout.ts`
intent that `components/PendingCheckoutRedirect.tsx` (mounted in `App.tsx` for
cloud builds) redeems → Checkout on first sign-in after email confirmation.
cloud-sync's Profile-tab `StoragePanel` shows the plan + renewal/cancellation/
grace date + a **Manage subscription** portal link. **Stripe setup (create
Products/Prices with the lookup_keys, secrets, webhook, enable pg_cron) is
operator config — see README.**

---

## Data Rights & Retention / GDPR (`..._gdpr_compliance.sql` + 3 edge functions)

Self-service data access, portability and erasure, plus automatic IP
minimisation. All account-gated (cloud-only) except the IP purge, which is
backend cron.

| Object | Type | Notes |
|--------|------|-------|
| `account_deletions` | table | `(user_id PK→auth.users, requested_at, scheduled_for)`. RLS: owner can **select** + **delete** (cancel); **no insert policy** — only the service role schedules, so the 7-day window can't be shortened client-side. |
| `purge_expired_personal_data()` | fn (SECURITY DEFINER) | (a) Nulls `submitted_by_ip` on `submissions`/`messages` older than **90 days**; (b) deletes `messages` and *reviewed* `submissions` older than **1 year** (pending submissions kept for moderation); deletes expired `banned_ips` + stale `login_attempts`. Run daily by `pg_cron`. |
| `due_account_deletions()` | fn (SECURITY DEFINER) | User ids whose `scheduled_for <= now()`. Read by the deletion worker. |

Edge functions (all `verify_jwt = false`; the two user-facing ones verify the
JWT manually):

- `export-account-data` — auth user → service-role gather of everything we hold
  (profile, subscription, roles, `sync_records`, contact `messages` by email,
  pending deletion). Returns JSON; the client adds cloud-file blobs + all local
  browser data and zips it.
- `request-account-deletion` — auth user → inserts an `account_deletions` row
  `scheduled_for = now()+7d` (idempotent; never shortens an in-flight request).
- `process-account-deletions` — **cron-only** (`x-cron-secret` must equal
  `DELETION_CRON_SECRET`). For each due user: removes their `user-files` Storage
  objects, then `auth.admin.deleteUser` (cascades profiles/sync_records/
  subscription/roles/account_deletions via FKs).

Scheduling: the migration always schedules the IP purge (pure SQL). The deletion
worker is auto-wired via `pg_cron` + `pg_net` **only if** a Vault secret
`deletion_cron_secret` exists (matching `DELETION_CRON_SECRET` on the function);
otherwise the migration raises a NOTICE and it's a documented operator step.

**Client** (cloud-sync plugin): `exportManifest.ts` (pure, unit-tested — assembles
the zip's text entries), `accountExport.ts` (I/O orchestrator: edge fn + local
stores + blob download → JSZip), `accountDeletion.ts` (email-OTP gate via
`signInWithOtp`/`verifyOtp` + schedule/cancel), and `DataPrivacyPanel.tsx` (the
Profile-tab "Data & privacy" panel). Admin `BannedIpsTab` exposes a ban TTL
(defaults to 90 days). Privacy policy "Your Rights" / "Data Retention" describe
all of the above.
