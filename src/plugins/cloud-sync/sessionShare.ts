// Share/unshare orchestration for cloud-synced logs (plan 0009).
//
// Publishing copies the raw log blob into the public shared-sessions bucket at
// {userId}/{token} and inserts an anon-readable shared_sessions row carrying the
// FROZEN course geometry — so recipients get precise lap/sector timing even for
// personal courses — plus display metadata. The public surface never sees the
// filename; the owner-side token↔filename mapping rides the log's private
// sync_records index row (data.share).
//
// Custom courses additionally auto-queue to the community submissions pipeline
// (best-effort — approval never gates a share link).

import { getFile } from "@/lib/fileStorage";
import { sharedFiles, sharedSessions } from "./cloudClient";
import { downloadCloudFile, patchFileIndexData, readFileIndexData } from "./syncEngine";
import { generateShareToken } from "./shareToken";
import { fileExtension, shareToken, shouldAutoPublish, type FileShareState } from "./shareState";
import type { Course } from "@/types/racing";

export type ShareErrorCode = "no-course" | "no-file";

/** Typed failure so the dialog can render a specific explanation. */
export class ShareError extends Error {
  readonly code: ShareErrorCode;
  constructor(code: ShareErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "ShareError";
  }
}

/** The file's current share state from its cloud index row. */
export async function getShareState(userId: string, name: string): Promise<FileShareState> {
  const data = await readFileIndexData(userId, name);
  return data?.share;
}

/** Resolve the session's tagged course from local track storage. */
async function resolveCourse(
  name: string,
): Promise<{ course: Course; trackName: string; courseName: string }> {
  const [{ getFileMetadata }, { loadTracks }] = await Promise.all([
    import("@/lib/fileStorage"),
    import("@/lib/trackStorage"),
  ]);
  const meta = await getFileMetadata(name);
  if (!meta?.trackName || !meta.courseName) throw new ShareError("no-course");
  const track = (await loadTracks()).find((t) => t.name === meta.trackName);
  const course = track?.courses.find((c) => c.name === meta.courseName);
  if (!course) throw new ShareError("no-course");
  return { course, trackName: meta.trackName, courseName: meta.courseName };
}

export interface Shareability {
  /** The session is tagged with a course that resolves locally (required to share). */
  hasCourse: boolean;
  /** That course is user-defined (the dialog notes it gets community-submitted). */
  isUserDefined: boolean;
}

/** What the share dialog needs to know before offering the toggle. */
export async function describeShareability(name: string): Promise<Shareability> {
  try {
    const { course } = await resolveCourse(name);
    return { hasCourse: true, isUserDefined: !!course.isUserDefined };
  } catch {
    return { hasCourse: false, isUserDefined: false };
  }
}

/**
 * Publish a cloud-synced log behind a fresh opaque token. Returns the token
 * (callers build the URL via shareState.shareUrl). Signed-in + online only.
 */
export async function shareSession(userId: string, name: string): Promise<{ token: string }> {
  const blob = (await getFile(name)) ?? (await downloadCloudFile(userId, name));
  if (!blob) throw new ShareError("no-file");

  const { course, trackName, courseName } = await resolveCourse(name);
  const { normalizeCourseSectors } = await import("@/lib/courseSectors");
  const frozen = normalizeCourseSectors(course);

  const { getFileMetadata } = await import("@/lib/fileStorage");
  const meta = await getFileMetadata(name);

  const token = generateShareToken();
  const path = `${userId}/${token}`;
  const { error: upErr } = await sharedFiles().upload(path, blob, {
    contentType: blob.type || "application/octet-stream",
  });
  if (upErr) throw new Error(`Failed to upload shared copy: ${upErr.message}`);

  const { error } = await sharedSessions().insert([
    {
      token,
      user_id: userId,
      file_ext: fileExtension(name),
      course: frozen,
      track_name: trackName,
      course_name: courseName,
      session_date: meta?.sessionStartTime ? new Date(meta.sessionStartTime).toISOString() : null,
      fastest_lap_ms: meta?.fastestLapMs != null ? Math.round(meta.fastestLapMs) : null,
      size_bytes: blob.size,
    },
  ]);
  if (error) {
    // Row rejected (e.g. quota trigger) — roll the public blob back so it
    // can't orphan in the bucket (mirrors uploadBlob's rollback).
    await sharedFiles().remove([path]).catch(() => {});
    throw new Error(`Failed to publish share: ${error.message}`);
  }

  await patchFileIndexData(userId, name, (data) => ({ ...(data ?? {}), share: { token } }));

  // Bonus: queue a user-defined course for the community DB. Never blocks.
  if (frozen.isUserDefined) {
    try {
      const { submitCustomCourse } = await import("./trackAutoSubmit");
      await submitCustomCourse(trackName, courseName, frozen);
    } catch (err) {
      console.error("Community course submission failed (share is live):", err);
    }
  }

  return { token };
}

/**
 * Retire a share: remove the public row + blob and mark the file opted out so a
 * later re-upload under a public-by-default profile does NOT resurrect it.
 */
export async function unshareSession(userId: string, name: string): Promise<void> {
  const token = shareToken(await getShareState(userId, name));
  if (token) {
    const { error } = await sharedSessions().delete().eq("token", token).eq("user_id", userId);
    if (error) throw new Error(`Failed to unshare: ${error.message}`);
    await sharedFiles().remove([`${userId}/${token}`]).catch(() => {});
  }
  await patchFileIndexData(userId, name, (data) => ({ ...(data ?? {}), share: { optedOut: true } }));
}

/**
 * Auto-publish hook for a just-pushed file: shares it iff the profile default
 * is public and the file has no share history. Best-effort by design — errors
 * are swallowed (the user can always share manually).
 */
export async function maybeAutoPublish(userId: string, name: string): Promise<void> {
  try {
    const { getMyProfile } = await import("./profile");
    const profile = await getMyProfile(userId);
    if (!profile?.share_sessions_default) return;
    if (!shouldAutoPublish(true, await getShareState(userId, name))) return;
    await shareSession(userId, name);
  } catch (err) {
    console.error("Auto-publish failed (log stays private):", err);
  }
}
