# Backend Reference — Supabase / Server-Side

> Extracted from `CLAUDE.md` to keep that file focused on the offline-first core.
> **Per Golden Rule #1, the core app needs none of this** — these subsystems are
> the accepted online exceptions (cloud sync, billing, account data rights).
> Read this before working on the `src/plugins/cloud-sync/` plugin, billing
> (`lib/billing*.ts`, `PricingCards`, `PlanCheckout`), GDPR/account flows, or
> anything under `supabase/` (migrations + edge functions). Operator setup
> (Stripe Products/Prices, secrets, `pg_cron`) lives in `README.md`.

---

## Cloud Sync (`src/plugins/cloud-sync/`)

Optional per-user backup/sync of the IndexedDB stores (see CLAUDE.md → IndexedDB
Storage) to Supabase. Built as a first-party plugin (Profile panels),
online-only (accepted offline-first exception). There are **no manual push/pull
buttons** — the **document tier auto-syncs**, and is
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
skipping pending keys. Its push goes through `pushDocRows`: one
optimistic batch, falling back to per-record upserts if the server quota trigger
rejects the batch — so an over-limit local set still **partial-syncs** everything
that fits and reports a `skipped` count (surfaced as a toast) rather than failing
wholesale. `autoSync` tracks `navigator.onLine` + window online/offline events;
the Profile-tab `StoragePanel` flags offline state + the pending count.

**Unified storage pool** (`storageTypes.ts`, enforced server-side) — there is
**one per-tier byte budget** that three data kinds share: **documents** (all
structured stores — auto-synced), **logs** (file blobs — opt-in), and
**snapshots** (`lap_snapshots` rows, by serialized size). The limit is
`subscription_tiers.total_bytes` (the single source of truth for the enforcing
triggers + the client meter); `sync_storage_usage()` returns the per-segment
breakdown + the one pooled limit for the Profile-tab segmented bar. Client checks
are advisory — the DB triggers are the real gate.

Backend (migrations `..._cloud_sync.sql`, `..._storage_quotas.sql`,
`..._unified_storage_quota.sql`):

| Object | Type | Notes |
|--------|------|-------|
| `sync_records` | table | One jsonb document per record: `(user_id, store, record_key, data, updated_at)`, unique on `(user_id, store, record_key)`. RLS: `auth.uid() = user_id`. `store`/`record_key` mirror the IndexedDB store name + key path. |
| `user-files` | Storage bucket | Private. Raw session blobs at `{user_id}/{encodeURIComponent(name)}`. RLS scopes objects to the owner's folder. |
| `total_storage_used(uuid)` | fn (SECURITY DEFINER) | Bytes a user occupies across `sync_records` + `lap_snapshots`. Used by the quota triggers + the trim job. |
| `tier_total_limit(uuid)` | fn (SECURITY DEFINER) | The user's single pooled byte budget from their tier `total_bytes`, falling back to free, then a hard 50 MB. |
| `enforce_sync_quota` | trigger | BEFORE INSERT/UPDATE on `sync_records`: rejects a write that pushes the caller's **pooled total** (this table + all `lap_snapshots`, minus the upserted row) over `tier_total_limit()` (`quota_exceeded`). |
| `enforce_snapshot_quota` | trigger | BEFORE INSERT/UPDATE on `lap_snapshots`: same pooled check keyed off the snapshot's serialized size (`quota_exceeded`). |
| `sync_storage_usage()` | RPC | Single row `(documents_bytes, logs_bytes, snapshots_bytes, total_limit_bytes)` for the caller — the limit reflects the caller's tier. |
| `profiles` | table | `(user_id PK→auth.users, display_name, avatar_path, avatar_updated_at, …)`. RLS: authenticated read-all, update/insert own. Display name is **unique case-insensitively** (`unique index on lower(display_name)`, plan 0006) but **not** a key — user-editable. |
| `public_profiles` | view | Plan 0006. Anon-readable, column-limited (`user_id, display_name, avatar_path, avatar_updated_at`) — backs the public `/driver/:username` page + Leaderboards avatar thumbnails without exposing the base table to anon. |
| `public_vehicles` | table | Plan 0006. Opt-in public projection of a user's vehicles `(user_id, vehicle_id PK, name, type_name, engine, number)` — **never weight/setup**. RLS: anon read, owner write. Synced off the garage-change path (`publicVehicleSync`); cascades on account delete. |
| `user-avatars` | Storage bucket | Plan 0006. **Public**. Avatar at `{user_id}/avatar.{webp\|jpg}` (cropped ≤256px client-side). Public read; owner-folder write. Not FK-cascaded — the deletion worker empties the folder. |
| `handle_new_user` | trigger | On `auth.users` insert: creates a profile, using the sign-up `display_name` or a generated silly name (`SpeedyRac3r-546`). `unique_display_name()` auto-suffixes a taken name at creation (case-insensitively); user edits get an explicit "taken" error instead. |

Synced stores (`syncStores.ts` — pure, unit-tested): `metadata`, `karts`,
`setups`, `notes`, `graph-prefs`, `vehicle-types`, `setup-templates`, `engines`,
`setup-revisions`, `tracks` (jsonb docs) + `files` (blobs). Video stores are
intentionally excluded (size). `vehicle-types`/`setup-templates` ride along
because setups are template-driven. `setup-revisions` are immutable,
content-addressed (id = content hash) frozen setups — they push/pull as ordinary
garage docs; the LWW merge is a no-op on collision since the key already implies
identical content. Their **orphan prune is local-only**: a pruned revision is
tombstoned (`setupRevisionTombstones.ts`), so `autoSync` skips the cloud delete
and the store accessor skips re-pulling it — the cloud copy survives for other
devices (see *Setup Revisions* in `CLAUDE.md`).
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
in the plugin's own KV store (`getPluginStore("cloud-sync")`). `pushFile` uploads
a single file's blob when its toggle is switched on. A `FileManagerSection` mount
(`CloudFilesSection`) lists **all** cloud
files — ones already on this device are marked present, others get a per-file
pull; pulling persists via `ctx.onSaveFile` (which refreshes the list). A
dedicated Cloud *tab* (a new garage-tab mount slot), `modified` detection, and a
"sync all" affordance remain follow-ups.

After a migration, regenerate `integrations/supabase/types.ts` from Supabase. Until
then `cloudClient.ts` accesses the new table/bucket through a narrowly-typed
escape hatch confined to that one module.

> **Lap-snapshot sync** uses its own dedicated `lap_snapshots` table, but its
> serialized size counts toward the **same pooled per-tier byte budget** as
> documents + logs — see CLAUDE.md → Lap Snapshots for the client model and the
> snapshot-specific sync rules.

---

## Leaderboards (`..._leaderboards.sql`, plan 0005)

Public community leaderboards built from submitted lap snapshots. **All access is
through RLS** (no edge function); the client lives in
`src/plugins/cloud-sync/leaderboardClient.ts`.

| Table | Purpose |
|-------|---------|
| `leaderboard_entries` | One row per submitted snapshot. Holds the frozen `data` jsonb (clean-lap samples + course geometry; engine-telemetry channels stripped client-side unless shared — **setup data is never uploaded**), the denormalized `display_name`, the raw `engine` + `engine_key`, the admin-overridable `engine_class_id` (+ `class_source`), the public `listed_weight`, `lap_time_ms`, a `content_hash`, and `status` (`approved` default / `denied`). `unique (user_id, content_hash)` blocks identical resubmits. |
| `engine_classes` | Admin-managed keyword groups (`name`, `keywords[]`, `sort_order`) that collapse free-text engine names into one class. |

| Function / trigger | What it does |
|---|---|
| `classify_engine(text)` | SECURITY DEFINER — first class whose any keyword is a substring of the engine key (by `sort_order`). |
| `leaderboard_set_class` | BEFORE INSERT on `leaderboard_entries`: auto-fills `engine_class_id` when the client didn't pin one. |
| `reclassify_entries()` | Admin RPC — re-runs `classify_engine` for every `class_source='auto'` row (manual overrides are protected). |

**RLS.** `leaderboard_entries`: `select` for **anon + authenticated** where
`status='approved'` (or own); users `insert`/`delete` their own; admins
(`has_role`) `select` all + `update` (status / class / notes). `engine_classes`:
public `select`, admin-only writes. Moderation is **allow-by-default** — entries are
visible immediately and only an admin **deny** hides them.

**Browse model.** The page selects only the light columns (no `data`) for all
approved rows and aggregates the Track→Course→engine/weight tree client-side
(`lib/leaderboardBrowse.ts`); opening a group re-queries the chosen ids **with
`data`** (`lib/leaderboardSession.ts` transposes them into one synthetic read-only
session). Promote to RPCs / a materialized view if row volume grows.

---

## Subscriptions / Stripe (`..._stripe_subscriptions.sql`, `..._subscription_grace_trim.sql` + 4 edge functions)

Paid tiers scale **one pooled cloud-storage budget** that documents + logs +
snapshots all share (`free` 50 MB → `plus` $1 10 GB → `premium` $3 100 GB →
`pro` $10 500 GB). `premium` carries no AI credits. Each paid tier bills
**monthly or annual**. Tiers are **data**, not code (numbers are provisional):

| Object | Type | Notes |
|--------|------|-------|
| `subscription_tiers` | table | One row per plan: `(tier PK, label, price_cents, total_bytes, ai_credits, stripe_price_id, sort_order)`. `total_bytes` is the single pooled storage budget. Authenticated read-all. Change a limit = UPDATE here. (`stripe_price_id` is a legacy fallback only — prices now resolve by lookup_key, see below.) |
| `user_subscriptions` | table | `(user_id PK→auth.users, tier→subscription_tiers, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, billing_interval, grace_until, logs_trimmed_at, updated_at)`. RLS: owner **read-only** — only the service role (webhook) writes, so no one can self-grant a tier. |
| `user_tier(uuid)` | fn (SECURITY DEFINER) | Effective tier: the subscription tier when `status in (active, trialing, past_due)`, else `free`. |
| `tier_total_limit(uuid)` | fn (SECURITY DEFINER) | The user's single pooled byte budget from their tier `total_bytes`; falls back to `free`, then a hard 50 MB. Used by both quota triggers + the usage RPC. |
| `encode_uri_component(text)` | fn | SQL parity with JS `encodeURIComponent`, so the trim job can address the right `user-files` bucket object (`{user_id}/{encoded name}`). |
| `trim_expired_logs()` | fn (SECURITY DEFINER) | For users past their `grace_until`, deletes synced **log** files newest-first (index row + bucket object) until their **pooled total** (docs + remaining logs + snapshots) fits the free `total_bytes`; snapshots + docs are never auto-deleted. Scheduled daily via `pg_cron` (guarded; enable the extension or run externally). Not granted to `authenticated`. |

**Prices via lookup_key (no Price ids in code):** each (tier × interval) has a
Stripe Price tagged with a lookup_key `${tier}_${interval}` (`plus_monthly`,
`plus_annual`, `premium_monthly`, …). Checkout and the catalogue resolve prices
live by lookup_key, so the Stripe dashboard is the single source of truth.

**On-hold tiers:** `COMING_SOON_TIERS` in `lib/billing.ts` (currently `premium`
and `pro`, the AI plan) lists tiers that exist but aren't self-service
purchasable yet — **hidden from the pricing UI entirely** (no teaser card),
excluded from `PlanCheckout`, and rejected by `create-checkout-session` (mirror
the set there). Only **Free** + **Plus** are shown at launch. They can still be
**comped** by creating the subscription directly in Stripe (set the
subscription's `metadata.user_id`, or change an existing customer's price); the
webhook grants whatever tier the price's lookup_key maps to.

**Admin comps (in-app, no Stripe):** the admin **Users** tab grants free months of
a paid tier via the `admin-users` edge function, which writes a `user_subscriptions`
row directly (tier `premium`, `status = active`, `current_period_end = now + N
months`, `grace_until = current_period_end + 60 days`, `cancel_at_period_end =
true`, **no `stripe_subscription_id`**). Because `user_tier()` is comp-aware, a row
with no Stripe id only grants its tier until `current_period_end` passes — so comps
**auto-expire** with no cron. Stripe-backed rows keep status-only semantics
(unchanged). The function refuses to touch a user who already has a
`stripe_subscription_id` (manage those in Stripe). See *User management* below.

**Comp expiry mirrors cancellation grace** (migration
`20260618000000_comp_expiry_grace_trim.sql`): a comp sets `grace_until =
current_period_end + 60 days`, and `trim_expired_logs()` now selects users by
**effective tier** (`user_tier(user_id) = 'free'`) instead of raw status — so a
**lapsed comp** (still `status = 'active'` but past its window) is trimmed just like
a cancelled Stripe sub, while every Stripe case is unchanged (active → paid →
excluded; cancelled → free → included). The Profile **StoragePanel** shows the user
a live "logs trim in N days" countdown during the grace window (`daysUntilTrim`),
and hides the Stripe portal buttons for any comp row (`hasCompGrant`).

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
  manage/upgrade/downgrade/cancel (no in-app billing UI). An optional
  `flow: "update"` deep-links into the change-plan screen (used by the profile's
  **Change plan** button); it falls back to the generic portal without an active
  subscription to update.

Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

### User management — `admin-users` edge function

A single admin-only function (`verify_jwt = false`; verifies the caller's JWT then
checks `user_roles` for `admin`, like `admin-build-zip`) backing the admin **Users**
tab (`src/components/admin/UsersTab.tsx`). Service-role actions:

- `list` (`{ page?, perPage? }`) → one row per account: email + `created_at` (from
  `auth.admin.listUsers`), `display_name` (`profiles`), effective tier/status/
  period-end (`user_subscriptions`, comp-aware), pooled storage used
  (`total_storage_used(uuid)` RPC per listed user) + limit (tier `total_bytes`), and
  a **track-contribution count** (`submissions.submitted_by_user_id`). Paginated.
- `grant_premium` (`{ user_id, months }`, 1–36) → upserts the comp row described
  above, **extending** an unexpired comp's end date. Refuses a Stripe-managed user.
- `clear_grant` (`{ user_id }`) → deletes a comp row (refuses Stripe-managed).

Submissions are attributed to a signed-in contributor via
`submissions.submitted_by_user_id`, which the `submit-track` edge function derives
from the caller's **verified JWT** (never a client-supplied id; anonymous stays
`NULL`). The admin Submissions tab resolves it to a `profiles.display_name`.

**Client wiring** (core, not the cloud-sync plugin — billing is account-level and
PricingCards renders even with cloud disabled): `lib/billing.ts` is the pure,
unit-tested layer (`isActiveStatus`/`effectiveTier`/`isPaidTier`/`pricingCta`,
plus `lookupKey`/`tiersWithPrices`/`paidTiersVisible`/`priceFor`/`formatPrice`,
`annualMonthlyEquivalent`/`annualDiscountPercent` for the checkout summary, the
`TIER_STORAGE_LABEL`/`TIER_DISPLAY_LABEL` maps + row/price shapes);
`lib/billingClient.ts` is the Supabase I/O (`fetchTiers`, `fetchMySubscription`,
`fetchStripeConfig`, `createCheckout(tier, interval)`, `createPortal(returnUrl,
flow?)`), through the same untyped escape hatch as `cloudClient.ts`.
`hooks/useSubscription.ts` reads the tier catalogue + the user's subscription;
`hooks/useStripePrices.ts` reads the live price catalogue (online, never throws).
`PricingCards` takes a `variant`: **home** (landing page — three cards: Free
offline, Free online, Plus, with a monthly/annual toggle) or **register**
(sign-up — two cards: Free online, which folds in the offline summary, + Plus, no
toggle). It shows live **Upgrade** / **Current plan** actions and — the
**failback** — hides the paid tiers entirely when `paidTiersVisible(config)` is
false. `PlanCheckout` (sign-up) is a checkout-style picker — a **storage-tier
dropdown** + **monthly/annual switch** — and `PlanCheckoutSummary` renders the
live **cost-per-month** (annual shows the monthly-equivalent + `annualDiscountPercent`
saving) next to the Create Account button. A paid choice stashes a
`lib/pendingCheckout.ts` intent that `components/PendingCheckoutRedirect.tsx`
(mounted in `App.tsx` for cloud builds) redeems → Checkout on first sign-in after
email confirmation. Sign-up takes **no display name** (the server auto-assigns a
random one, changeable later); display-name edits run through a basic
`lib/profanity.ts` filter. cloud-sync's Profile-tab `StoragePanel` shows the plan
+ renewal/cancellation/grace date + a **Manage subscription** portal link and,
for active subscribers, a **Change plan** button (portal `flow: "update"`).
**Stripe setup (create Products/Prices with the lookup_keys, secrets, webhook,
enable pg_cron) is operator config — see README.**

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
  `DELETION_CRON_SECRET`). For each due user: `auth.admin.deleteUser` (cascades
  profiles/sync_records/public_vehicles/subscription/roles/account_deletions via
  FKs), then removes their `user-files` **and** `user-avatars` Storage objects
  (buckets aren't FK-cascaded).

Scheduling: the migration always schedules the IP purge (pure SQL). The deletion
worker is auto-wired via `pg_cron` + `pg_net` **only if** a Vault secret
`deletion_cron_secret` exists (matching `DELETION_CRON_SECRET` on the function);
otherwise the migration raises a NOTICE and it's a documented operator step.

**Client** (cloud-sync plugin): `exportManifest.ts` (pure, unit-tested — assembles
the zip's text entries), `accountExport.ts` (I/O orchestrator: edge fn + local
stores + blob download → JSZip), `accountImport.ts` (the reverse — restores a
data-export ZIP's local stores + file blobs into this browser via the sync
accessors; the cross-origin migration path, e.g. old domain → new domain;
pure entry-classifier unit-tested), `accountDeletion.ts` (email-OTP gate via
`signInWithOtp`/`verifyOtp` + schedule/cancel), and `DataPrivacyPanel.tsx` (the
Profile-tab "Data & privacy" panel — export, import, and delete). Admin `BannedIpsTab` exposes a ban TTL
(defaults to 90 days). Privacy policy "Your Rights" / "Data Retention" describe
all of the above.
