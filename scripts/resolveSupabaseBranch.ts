// Build-time resolver: map the CI git branch to its Supabase **preview-branch**
// database via the Supabase Management API, so a per-branch front-end preview
// talks to that branch's own ephemeral DB instead of the one static beta DB.
//
// Why this exists: Cloudflare Workers Builds deploys every non-`main` branch as a
// preview, but `vite.config.ts` bakes a single fixed set of `*_PREVIEW` Supabase
// creds (the beta DB) into all of them. Supabase Branching, meanwhile, spins up a
// fresh preview database per git branch — but ONLY when that branch carries
// migration changes — with its own project ref, API URL and anon key. Nothing
// linked the two. This module is that link: at build time it asks the Management
// API "is there a Supabase branch for this git branch?" and, if so, returns its
// creds for vite.config to bake in. When there's no branch (no DB changes) or the
// branch isn't healthy, it returns null and the caller falls back to the existing
// static `_PREVIEW`/beta creds — i.e. today's behaviour, unchanged.
//
// This is pure build tooling (Node, runs in CI), never shipped to the client, so
// it has zero bearing on the offline-first runtime.

/** Supabase Management API base. */
const MANAGEMENT_API = "https://api.supabase.com";

/** How long to wait on the Management API before giving up and falling back. A
 * slow/Down control plane must never stall or fail a deploy. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Resolved creds for a branch's preview database. Mirrors the three Supabase
 * `VITE_*` keys vite.config bakes in. */
export interface BranchBackend {
  /** `https://{ref}.supabase.co` */
  url: string;
  /** The preview branch's anon (publishable) key. */
  anonKey: string;
  /** The preview branch's own project ref. */
  projectId: string;
}

/** Subset of a Management API branch object (`GET /v1/projects/{ref}/branches`)
 * that we rely on. The API returns more fields; we only type what we read. */
export interface ManagementBranch {
  id: string;
  /** The preview branch's OWN project ref (a distinct Supabase project). */
  project_ref: string;
  /** The git branch this preview branch tracks. */
  git_branch?: string;
  /** Provisioning/migration status — see READY_STATUSES. */
  status?: string;
  /** True for the production/default branch (parent project) — never a preview. */
  is_default?: boolean;
}

/** One entry of `GET /v1/projects/{ref}/api-keys`. */
interface ApiKey {
  name?: string;
  api_key?: string;
}

/** Branch statuses where the preview database is provisioned and safe to point a
 * front-end at. A branch mid-provision or with failed migrations is deliberately
 * skipped so we never bake creds for a half-built/broken DB — we fall back
 * instead. Source: Supabase branch lifecycle statuses. */
const READY_STATUSES: ReadonlySet<string> = new Set([
  "MIGRATIONS_PASSED",
  "FUNCTIONS_DEPLOYED",
  "ACTIVE_HEALTHY",
]);

/**
 * Pure selection: from a list of Management API branches, pick the (non-default)
 * preview branch tracking `gitBranch`. Returns null when none matches. Extracted
 * so the matching logic is unit-testable without any network.
 */
export function selectBranchForGit(
  branches: ManagementBranch[],
  gitBranch: string,
): ManagementBranch | null {
  if (!gitBranch) return null;
  return (
    branches.find((b) => !b.is_default && b.git_branch === gitBranch) ?? null
  );
}

/** Pure: is this branch's database provisioned enough to use? */
export function isBranchReady(branch: ManagementBranch): boolean {
  return !!branch.status && READY_STATUSES.has(branch.status);
}

/** Pure: pick the anon/publishable key out of an api-keys response. */
export function pickAnonKey(keys: ApiKey[]): string | null {
  const anon = keys.find((k) => k.name === "anon");
  if (anon?.api_key) return anon.api_key;
  const publishable = keys.find((k) => k.name === "publishable");
  return publishable?.api_key ?? null;
}

export interface ResolveOptions {
  /** The CI git branch being built (e.g. `WORKERS_CI_BRANCH`). */
  gitBranch: string;
  /** The PRODUCTION project ref the branches hang off (parent project). */
  prodProjectRef: string;
  /** A Supabase personal access token with access to the project. */
  accessToken: string;
  /** Injectable fetch (for tests); defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable logger (for tests); defaults to console.warn. */
  warn?: (msg: string) => void;
}

async function getJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  accessToken: string,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the Supabase preview-branch database for the current git branch, or
 * null to fall back to the static `_PREVIEW`/beta creds.
 *
 * Returns null (silently falls back) when: the access token or git branch is
 * missing, the branch is `main`, no Supabase branch tracks this git branch (the
 * common "no DB changes, so no branch was generated" case), the branch isn't
 * healthy yet, the anon key can't be read, or the Management API errors/times
 * out. It NEVER throws — a backend resolution problem must not break a build.
 */
export async function resolveBranchBackend(
  opts: ResolveOptions,
): Promise<BranchBackend | null> {
  const {
    gitBranch,
    prodProjectRef,
    accessToken,
    fetchImpl = fetch,
    warn = (m) => console.warn(m),
  } = opts;

  if (!accessToken || !gitBranch || gitBranch === "main" || !prodProjectRef) {
    return null;
  }

  try {
    const branches = await getJson<ManagementBranch[]>(
      fetchImpl,
      `${MANAGEMENT_API}/v1/projects/${prodProjectRef}/branches`,
      accessToken,
    );
    if (!Array.isArray(branches)) {
      warn(`[supabase-branch] could not list branches for ${prodProjectRef}`);
      return null;
    }

    const branch = selectBranchForGit(branches, gitBranch);
    if (!branch) {
      // No DB changes on this branch → Supabase made no preview branch. Normal.
      return null;
    }
    if (!isBranchReady(branch)) {
      warn(
        `[supabase-branch] branch "${gitBranch}" found but status=${branch.status}; falling back`,
      );
      return null;
    }

    const keys = await getJson<ApiKey[]>(
      fetchImpl,
      `${MANAGEMENT_API}/v1/projects/${branch.project_ref}/api-keys?reveal=true`,
      accessToken,
    );
    const anonKey = Array.isArray(keys) ? pickAnonKey(keys) : null;
    if (!anonKey) {
      warn(`[supabase-branch] no anon key for branch project ${branch.project_ref}`);
      return null;
    }

    return {
      url: `https://${branch.project_ref}.supabase.co`,
      anonKey,
      projectId: branch.project_ref,
    };
  } catch (err) {
    warn(`[supabase-branch] resolution failed, falling back: ${String(err)}`);
    return null;
  }
}
