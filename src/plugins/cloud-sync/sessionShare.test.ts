import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Course, Track } from "@/types/racing";

// sessionShare orchestrates local storage (fake-indexeddb, real), the cloud seam
// (`./cloudClient`, mocked stateful in-memory — same approach as syncEngine.test),
// track storage (mocked fixtures), and the community submit hook (spied).

interface Row {
  user_id: string;
  store: string;
  record_key: string;
  data: unknown;
}

const { cloud, submitSpy, profileState } = vi.hoisted(() => ({
  cloud: {
    rows: [] as Row[],
    bucket: new Map<string, Blob>(), // user-files (private)
    sharedRows: [] as Record<string, unknown>[],
    sharedBucket: new Map<string, Blob>(),
    sharedInsertError: null as { message: string } | null,
    sharedDeleteError: null as { message: string } | null,
  },
  submitSpy: vi.fn(async () => true),
  profileState: { row: null as { share_sessions_default?: boolean } | null },
}));

vi.mock("./cloudClient", () => {
  const syncRecords = () => {
    let op: "select" | "delete" | null = null;
    const filters: Record<string, string> = {};
    const match = () =>
      cloud.rows.filter((r) =>
        Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, string>)[k] === v),
      );
    const builder = {
      upsert: (rows: Row[]) => {
        for (const r of rows) {
          const i = cloud.rows.findIndex(
            (x) => x.user_id === r.user_id && x.store === r.store && x.record_key === r.record_key,
          );
          if (i >= 0) cloud.rows[i] = r;
          else cloud.rows.push(r);
        }
        return Promise.resolve({ error: null });
      },
      select: () => ((op = "select"), builder),
      delete: () => ((op = "delete"), builder),
      eq: (col: string, val: string) => ((filters[col] = val), builder),
      maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (op === "delete") {
          cloud.rows = cloud.rows.filter((r) => !match().includes(r));
          return resolve({ error: null });
        }
        return resolve({ data: match(), error: null });
      },
    };
    return builder;
  };

  const sharedSessions = () => {
    const filters: Record<string, string> = {};
    const builder = {
      insert: (rows: Record<string, unknown>[]) => {
        if (cloud.sharedInsertError) return Promise.resolve({ error: cloud.sharedInsertError });
        cloud.sharedRows.push(...rows);
        return Promise.resolve({ error: null });
      },
      delete: () => builder,
      eq: (col: string, val: string) => ((filters[col] = val), builder),
      then: (resolve: (v: unknown) => unknown) => {
        if (cloud.sharedDeleteError) return resolve({ error: cloud.sharedDeleteError });
        cloud.sharedRows = cloud.sharedRows.filter(
          (r) => !Object.entries(filters).every(([k, v]) => r[k] === v),
        );
        return resolve({ error: null });
      },
    };
    return builder;
  };

  return {
    SYNC_BUCKET: "user-files",
    syncRecords,
    userFiles: () => ({
      download: (path: string) => {
        const hit = cloud.bucket.get(path);
        return Promise.resolve(
          hit ? { data: hit, error: null } : { data: null, error: { message: "missing" } },
        );
      },
      upload: () => Promise.resolve({ error: null }),
      remove: () => Promise.resolve({ error: null }),
    }),
    sharedSessions,
    sharedFiles: () => ({
      upload: (path: string, blob: Blob) => {
        cloud.sharedBucket.set(path, blob);
        return Promise.resolve({ error: null });
      },
      remove: (paths: string[]) => {
        paths.forEach((p) => cloud.sharedBucket.delete(p));
        return Promise.resolve({ error: null });
      },
    }),
    fetchStorageUsage: async () => null,
    isQuotaError: (err: unknown) => err instanceof Error && /quota_exceeded/i.test(err.message),
  };
});

const COURSE: Course = {
  name: "Club Circuit",
  startFinishA: { lat: 40.0001, lon: -80.0001 },
  startFinishB: { lat: 40.0002, lon: -80.0002 },
  isUserDefined: false,
};
const TRACKS: Track[] = [{ name: "Local Kart Club", courses: [COURSE] }];

vi.mock(import("@/lib/trackStorage"), async (importOriginal) => ({
  ...(await importOriginal()),
  loadTracks: async () => TRACKS,
}));

vi.mock("./trackAutoSubmit", () => ({
  submitCustomCourse: submitSpy,
}));

vi.mock("./profile", () => ({
  getMyProfile: async () => profileState.row,
}));

import { freshIndexedDB } from "@/lib/__test__/idb";
import { saveFile, saveFileMetadata } from "@/lib/fileStorage";
import {
  getShareState,
  maybeAutoPublish,
  shareSession,
  ShareError,
  unshareSession,
} from "./sessionShare";

const U = "user-1";
const NAME = "morning-session.dovex";

async function seedLocalFile(opts?: { trackName?: string; courseName?: string }) {
  await saveFile(NAME, new Blob(["gps-data"]));
  await saveFileMetadata({
    fileName: NAME,
    trackName: opts?.trackName ?? "Local Kart Club",
    courseName: opts?.courseName ?? "Club Circuit",
    sessionStartTime: Date.UTC(2026, 6, 1, 14, 30),
    fastestLapMs: 51234.7,
  });
}

beforeEach(() => {
  freshIndexedDB();
  cloud.rows = [];
  cloud.bucket = new Map();
  cloud.sharedRows = [];
  cloud.sharedBucket = new Map();
  cloud.sharedInsertError = null;
  cloud.sharedDeleteError = null;
  submitSpy.mockClear();
  profileState.row = null;
  COURSE.isUserDefined = false;
});

describe("shareSession", () => {
  it("publishes the blob + row and stamps the token on the index row", async () => {
    await seedLocalFile();
    cloud.rows = [{ user_id: U, store: "files", record_key: NAME, data: { size: 8 } }];

    const { token } = await shareSession(U, NAME);
    expect(token).toMatch(/^[A-Za-z0-9\-_]{22}$/);
    expect(cloud.sharedBucket.has(`${U}/${token}`)).toBe(true);

    expect(cloud.sharedRows).toHaveLength(1);
    expect(cloud.sharedRows[0]).toMatchObject({
      token,
      user_id: U,
      file_ext: "dovex",
      track_name: "Local Kart Club",
      course_name: "Club Circuit",
      fastest_lap_ms: 51235,
      size_bytes: 8,
    });
    expect(cloud.sharedRows[0].course).toMatchObject({ name: "Club Circuit" });
    expect(cloud.sharedRows[0].session_date).toBe(new Date(Date.UTC(2026, 6, 1, 14, 30)).toISOString());

    // The filename never leaves the private index row.
    expect(JSON.stringify(cloud.sharedRows[0])).not.toContain(NAME);
    expect(await getShareState(U, NAME)).toEqual({ token });
  });

  it("rolls the public blob back when the row insert is rejected", async () => {
    await seedLocalFile();
    cloud.sharedInsertError = { message: "quota_exceeded" };
    await expect(shareSession(U, NAME)).rejects.toThrow(/Failed to publish/);
    expect(cloud.sharedBucket.size).toBe(0);
    expect(await getShareState(U, NAME)).toBeUndefined();
  });

  it("throws a typed no-course error when the session's course can't be resolved", async () => {
    await seedLocalFile({ trackName: "Unknown Track" });
    await expect(shareSession(U, NAME)).rejects.toMatchObject({ code: "no-course" });
    expect(cloud.sharedBucket.size).toBe(0);
  });

  it("throws a typed no-file error when the blob exists nowhere", async () => {
    await saveFileMetadata({ fileName: NAME, trackName: "Local Kart Club", courseName: "Club Circuit" });
    await expect(shareSession(U, NAME)).rejects.toBeInstanceOf(ShareError);
  });

  it("falls back to the cloud blob for a file not stored on this device", async () => {
    await saveFileMetadata({ fileName: NAME, trackName: "Local Kart Club", courseName: "Club Circuit" });
    cloud.bucket.set(`${U}/${encodeURIComponent(NAME)}`, new Blob(["cloud-copy"]));

    const { token } = await shareSession(U, NAME);
    expect(cloud.sharedBucket.has(`${U}/${token}`)).toBe(true);
  });

  it("queues a user-defined course for community submission (best-effort)", async () => {
    COURSE.isUserDefined = true;
    await seedLocalFile();
    await shareSession(U, NAME);
    expect(submitSpy).toHaveBeenCalledWith("Local Kart Club", "Club Circuit", expect.objectContaining({ name: "Club Circuit" }));
  });

  it("a community-submit failure never blocks the share", async () => {
    COURSE.isUserDefined = true;
    submitSpy.mockRejectedValueOnce(new Error("edge fn down"));
    await seedLocalFile();
    const { token } = await shareSession(U, NAME);
    expect(cloud.sharedRows.some((r) => r.token === token)).toBe(true);
  });

  it("does not submit built-in courses", async () => {
    await seedLocalFile();
    await shareSession(U, NAME);
    expect(submitSpy).not.toHaveBeenCalled();
  });
});

describe("unshareSession", () => {
  it("removes the row + blob and marks the file opted out", async () => {
    await seedLocalFile();
    await shareSession(U, NAME);

    await unshareSession(U, NAME);
    expect(cloud.sharedRows).toEqual([]);
    expect(cloud.sharedBucket.size).toBe(0);
    expect(await getShareState(U, NAME)).toEqual({ optedOut: true });
  });

  it("still marks opted out when there was no live token", async () => {
    await seedLocalFile();
    await unshareSession(U, NAME);
    expect(await getShareState(U, NAME)).toEqual({ optedOut: true });
  });
});

describe("maybeAutoPublish", () => {
  it("publishes when the profile default is public and the file is unshared", async () => {
    profileState.row = { share_sessions_default: true };
    await seedLocalFile();
    await maybeAutoPublish(U, NAME);
    expect(cloud.sharedRows).toHaveLength(1);
  });

  it("does nothing when the default is private", async () => {
    profileState.row = { share_sessions_default: false };
    await seedLocalFile();
    await maybeAutoPublish(U, NAME);
    expect(cloud.sharedRows).toEqual([]);
  });

  it("never resurrects an explicit opt-out", async () => {
    profileState.row = { share_sessions_default: true };
    await seedLocalFile();
    await unshareSession(U, NAME);
    await maybeAutoPublish(U, NAME);
    expect(cloud.sharedRows).toEqual([]);
  });

  it("skips an already-shared file", async () => {
    profileState.row = { share_sessions_default: true };
    await seedLocalFile();
    await shareSession(U, NAME);
    await maybeAutoPublish(U, NAME);
    expect(cloud.sharedRows).toHaveLength(1);
  });

  it("swallows errors (best-effort)", async () => {
    profileState.row = { share_sessions_default: true };
    // No local file + no metadata → shareSession throws inside; must not escape.
    await expect(maybeAutoPublish(U, NAME)).resolves.toBeUndefined();
  });
});
