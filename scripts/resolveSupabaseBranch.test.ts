import { describe, it, expect, vi } from "vitest";
import {
  selectBranchForGit,
  isBranchReady,
  pickAnonKey,
  resolveBranchBackend,
  type ManagementBranch,
} from "./resolveSupabaseBranch";

const branch = (over: Partial<ManagementBranch>): ManagementBranch => ({
  id: "b1",
  project_ref: "preview123",
  git_branch: "feature/x",
  status: "MIGRATIONS_PASSED",
  is_default: false,
  ...over,
});

describe("selectBranchForGit", () => {
  it("matches a non-default branch by git_branch", () => {
    const list = [
      branch({ id: "prod", is_default: true, git_branch: "main" }),
      branch({ id: "feat", git_branch: "feature/x" }),
    ];
    expect(selectBranchForGit(list, "feature/x")?.id).toBe("feat");
  });

  it("never returns the default (production) branch", () => {
    const list = [branch({ id: "prod", is_default: true, git_branch: "main" })];
    expect(selectBranchForGit(list, "main")).toBeNull();
  });

  it("returns null when no branch tracks the git branch", () => {
    expect(selectBranchForGit([branch({ git_branch: "other" })], "feature/x")).toBeNull();
  });

  it("returns null for an empty git branch", () => {
    expect(selectBranchForGit([branch({})], "")).toBeNull();
  });
});

describe("isBranchReady", () => {
  it.each(["MIGRATIONS_PASSED", "FUNCTIONS_DEPLOYED", "ACTIVE_HEALTHY"])(
    "treats %s as ready",
    (status) => expect(isBranchReady(branch({ status }))).toBe(true),
  );

  it.each(["RUNNING_MIGRATIONS", "MIGRATIONS_FAILED", "CREATING_PROJECT", undefined])(
    "treats %s as not ready",
    (status) => expect(isBranchReady(branch({ status }))).toBe(false),
  );
});

describe("pickAnonKey", () => {
  it("prefers the anon key", () => {
    expect(pickAnonKey([{ name: "service_role", api_key: "s" }, { name: "anon", api_key: "a" }])).toBe("a");
  });
  it("falls back to publishable", () => {
    expect(pickAnonKey([{ name: "publishable", api_key: "p" }])).toBe("p");
  });
  it("returns null when neither is present", () => {
    expect(pickAnonKey([{ name: "secret", api_key: "x" }])).toBeNull();
  });
});

describe("resolveBranchBackend", () => {
  const baseOpts = {
    gitBranch: "feature/x",
    prodProjectRef: "prodref",
    accessToken: "token",
    warn: () => {},
  };

  const okFetch = (branches: unknown, keys: unknown): typeof fetch =>
    vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      const body = u.includes("/branches") ? branches : keys;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

  it("resolves a ready branch to its creds", async () => {
    const res = await resolveBranchBackend({
      ...baseOpts,
      fetchImpl: okFetch(
        [branch({ project_ref: "preview123", git_branch: "feature/x" })],
        [{ name: "anon", api_key: "anonkey" }],
      ),
    });
    expect(res).toEqual({
      url: "https://preview123.supabase.co",
      anonKey: "anonkey",
      projectId: "preview123",
    });
  });

  it("returns null without an access token", async () => {
    expect(await resolveBranchBackend({ ...baseOpts, accessToken: "" })).toBeNull();
  });

  it("returns null on main", async () => {
    expect(await resolveBranchBackend({ ...baseOpts, gitBranch: "main" })).toBeNull();
  });

  it("falls back when no branch matches (the no-DB-changes case)", async () => {
    const res = await resolveBranchBackend({
      ...baseOpts,
      fetchImpl: okFetch([branch({ git_branch: "unrelated" })], []),
    });
    expect(res).toBeNull();
  });

  it("falls back when the branch is not ready", async () => {
    const res = await resolveBranchBackend({
      ...baseOpts,
      fetchImpl: okFetch(
        [branch({ git_branch: "feature/x", status: "MIGRATIONS_FAILED" })],
        [{ name: "anon", api_key: "anonkey" }],
      ),
    });
    expect(res).toBeNull();
  });

  it("falls back when the anon key is missing", async () => {
    const res = await resolveBranchBackend({
      ...baseOpts,
      fetchImpl: okFetch([branch({ git_branch: "feature/x" })], [{ name: "secret", api_key: "x" }]),
    });
    expect(res).toBeNull();
  });

  it("never throws on a network error", async () => {
    const res = await resolveBranchBackend({
      ...baseOpts,
      fetchImpl: vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    });
    expect(res).toBeNull();
  });

  it("falls back on a non-OK list response", async () => {
    const res = await resolveBranchBackend({
      ...baseOpts,
      fetchImpl: vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    });
    expect(res).toBeNull();
  });
});
