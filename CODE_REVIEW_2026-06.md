# Dove's DataViewer / HackTheTrack — Deep Code Review

**Date:** 2026-06-05 · **Reviewed at:** `main` @ `7853e41` (v2.2.2)
**Method:** 5 parallel review agents (architecture, performance, security, testing, tooling) + full local CI verification.
**Lens:** judged as a **commercial product shipped by a solo developer**, on a 1–10 scale where **10 = "impossible for one person" (Linux-kernel tier)**.

---

## Overall Rating: **8 / 10**

This is genuinely excellent solo work — a released, CI-gated, offline-first PWA with a real backend, a plugin architecture, 10 telemetry parsers (one of them a Rust→WASM core), and 1,259 passing tests. It is **maintainable, disciplined, and commercially credible today**. It is not a 9–10 because a 9–10 implies systemic engineering that survives scale and a team handoff with zero soft spots: here a few concentrated coupling points, an untested orchestration layer, a known hot-path performance miss, and missing security/e2e automation separate "excellent" from "exceptional."

For context on the "10 is impossible for one person" anchor: this is unambiguously a one-person project (AI-assisted), so by that anchor it *cannot* be a 10 — and an 8 here means "near the ceiling of what the rubric allows for a solo artifact."

### Scorecard

| Dimension | Score | One-line verdict |
|---|---|---|
| Architecture & Modularity | **8.5** | Clean lib→hook→view layering; offline-first boundary is *structurally enforced*. |
| Testing & Code Quality | **8.5** | Real-fixture tests (drives the actual WASM), zero TODOs, disciplined error handling. |
| Security (backend/Supabase) | **8.0** | Universal RLS, verified+idempotent Stripe webhook, no critical/high findings. |
| Tooling / CI / Infra | **7.5** | 5 parallel CI workflows, strict TS; gaps in security scanning & e2e. |
| Performance (hot paths) | **7.0** | Smart where it counts (WASM worker, sub-quadratic math); one real chart miss. |

### CI ground truth (verified locally, not taken on faith)
- ✅ **Lint** clean · ✅ **Typecheck** (`tsc -b`) clean · ✅ **Build** clean
- ✅ **1,259 tests / 96 files pass** in ~7s
- 📊 **Coverage 57.4% lines** (51% branches) — *honestly scoped to logic* (view layer excluded by design), above the configured floors
- 📦 Initial JS chunk **480 KB (139 KB gzip)**, total dist 6 MB
- ⚠️ `npm audit`: **4 moderate** (dev-only esbuild SSRF via Vite; react-router open-redirect) — no high/critical

---

## What's genuinely strong

1. **The offline-first invariant is enforced by structure, not willpower.** Zero Supabase imports in `src/hooks/`, zero in core `src/lib/`; all cloud code is quarantined in the `cloud-sync` plugin or env-gated admin/auth. `src/lib/` has **zero React imports** — every parser/utility is framework-free, pure, and unit-tested.
2. **Type & rot discipline is top-tier.** 0 `@ts-ignore`, 1 `:any` (in generated WASM glue), all 11 `as any` are justified Supabase-type-lag casts with documented removal triggers. **0 TODO/FIXME/HACK** in non-test source, ~4 stray `console.log`. The "no dead code" standard in CLAUDE.md is actually lived.
3. **Tests are real, not theater.** The XRK test drives the *actual committed Rust→WASM core* against a 3.1 MB real AiM session; lap-delta tests use analytically-exact geometry; parsers have adversarial edge-case + `ParserStats` rejection coverage; regression tests are pinned to bundled real sample files.
4. **The backend fundamentals that usually sink solo Supabase apps are all correct.** Universal RLS, no self-serve role/entitlement escalation, Stripe webhook signature-verified and the *sole* entitlement writer (idempotent, out-of-order-safe), service-role tables locked with explicit deny-all, OTP-gated account deletion, anon-only client creds, clean XSS surface (0 `dangerouslySetInnerHTML`/`eval`).
5. **Performance literacy where it matters.** Heaviest parse (XRK) is worker-offloaded with transferable buffers + precached WASM; lap/delta/alignment math is sub-quadratic (binary search, monotonic windows); the Leaflet map is memoized away from the playback cursor; bundle is split with documented trade-offs.
6. **Process polish.** 5 parallel CI workflows (each its own badge), strict TypeScript, Keep-a-Changelog + SemVer tags (v1.5.0→v2.2.2), a clever Gist-based coverage badge that sidesteps a real Cloudflare-deploy footgun, and a thorough, *accurate*, maintained CLAUDE.md.

---

## Critical issues to address

> None are "Critical/exploitable-data-theft." These are the highest-leverage risks for a paid product.

### 🔴 C1 — Cloud storage has no server-side upload cap (security M1)
`user-files` bucket is created with only `public: false` — **no `file_size_limit`, no MIME allow-list** (`supabase/migrations/20260524120000_cloud_sync.sql:48`). The byte quota is enforced on the *index row* (`sync_records` trigger), but `uploadBlob` writes the blob to Storage **first** (`syncEngine.ts:41-55`). A client that talks to Storage directly (RLS permits its own folder) can store **unbounded data** with no server cap; the orphan-sweep is best-effort. **Fix:** set `file_size_limit` + `allowed_mime_types` on the bucket.

### 🔴 C2 — Playback redraws the entire chart dataset every frame (performance #1)
The Canvas draw `useEffect` lists `currentIndex` in its deps (`TelemetryChart.tsx:488`, `SingleSeriesChart.tsx:384`). During playback `usePlayback` updates the cursor ~per animation frame, so every tick **reallocates the canvas backing store** and re-walks all N samples (plus rebuilds `samples.map(getSpeed)` twice and `Math.max(...speeds)` spread). This is the exact scenario the product exists for (high-frequency cursor over tens of thousands of samples), multiplied across every pro-mode series card. **Fix:** split into a static layer (data traces, keyed on data not cursor) + a cheap cursor-only overlay layer → O(n)→O(1) per tick. This single fix is the biggest UX win available.

### 🟠 C3 — Abuse-control endpoints trust client IP & fail-open CAPTCHA (security M2/M3)
`submit-track`/`submit-message` derive the rate-limit/ban IP from client-controlled `x-forwarded-for` *first* (`submit-track/index.ts:127`), and Turnstile is **silently skipped when the secret is unset** (`:26-29`) on an unauthenticated, service-role-backed bulk-insert path (up to 200 rows). Impact is spam/abuse, not data theft. **Fix:** prefer `cf-connecting-ip`; make missing Turnstile secret a loud operational alarm rather than a silent bypass.

---

## Improvements, by area (ranked)

**Architecture**
- Decompose the **72-field `SessionContextValue`** (`Index.tsx:344-439`, ~40-entry dep array) into concern-scoped sub-contexts (reference / overlay / video / metadata). It's the single largest coupling surface and the dep array re-runs on any field change.
- Split `RaceLineView.tsx` (907 lines) into layer sub-components (heatmap / braking-zone / overlay).
- Unify the hand-wired snapshot/reference/overlay slot-coordination callbacks (`Index.tsx:210-254`) into one `useComparisonSlots` hook.
- Defer `vendor-supabase` off the initial bundle (gate `AuthProvider`/`SubmitTrackDialog`) — documented, still on the critical path (169 KB).

**Testing**
- **Close the hook gap:** ~26 hooks, only `useDataLoader` is tested. The orchestration layer (`useLapManagement`, `useReferenceLap`, `useSessionData`, `usePlayback`, `useVideoSync`) is exactly where the "stale-state gotcha" CLAUDE.md warns about lives.
- Add **integration/e2e** (Playwright) for the file→parse→detect→render pipeline and offline/service-worker behavior — currently nothing exercises the real browser path, the product's core differentiator.

**Performance (beyond C2)**
- NMEA GGA lookup is O(n×500) on the main thread (`nmeaParser.ts:225-241`) — pre-sort keys + binary-search nearest.
- Cache a single open `IDBDatabase` + add bulk `getAll` helpers; today every CRUD op opens/closes a connection (`dbUtils.ts:175-207`), so the file browser pays M opens for M files.
- Video export composites on the main thread → UI jank; consider OffscreenCanvas + worker.

**Tooling / Infra**
- **Add security scanning to CI** (CodeQL + an `npm audit` gate) — the biggest CI gap given accounts + Stripe; would have surfaced the 4 live advisories.
- Reconcile the toolchain drift: **`.nvmrc` Node 20 vs CI Node 22**; **two competing lockfiles** (`package-lock.json` + `bun.lock`) — pick npm (CI uses it) and drop the other.
- Re-enable unused-var/dead-code detection — both ESLint (`no-unused-vars: "off"`, `eslint.config.js:26`) and TS (`noUnusedLocals: false`) disable it, contradicting the repo's own "no dead code" rule.
- Prune the **38 branches** (stale `claude/*`, `dependabot/*`, `BETA`, `badges`…) and close the dependabot loop.
- Remove 3 stray `console.log`s in video code (`VideoPlayer.tsx:475`, `videoExport.ts:92,129`).

**Security (hardening, beyond C1/C3)**
- Restrict edge-function CORS from `*` to app origins (esp. unauthenticated `submit-*`).
- `export-account-data` matches messages by email only — breaks if a user changes email (GDPR completeness).
- Consider app-level encryption of cloud telemetry blobs (location data) — the `claude/user-data-encryption` branch is unmerged.

---

## Bottom line

A solo developer has shipped a released, professionally-engineered, offline-first telemetry product with a clean architecture, real test rigor, a sound Supabase backend, and disciplined process — well above the typical solo-commercial bar. **8/10.** Land the storage cap (C1), the chart-layer fix (C2), and a CI security gate, and this is knocking on 9.
