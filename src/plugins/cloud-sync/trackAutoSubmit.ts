// Auto-submit a custom course to the community track database.
//
// When a leaderboard snapshot or a shared session (plan 0009) is on a track that
// isn't in the built-in list, we also push that course to the `submissions` review
// queue via the same submit-track edge function the manual SubmitTrackDialog uses —
// so the community DB gathers the geometry of tracks people are actually posting
// laps on. Best-effort: a failure here must never block the caller's flow. The
// signed-in user's JWT is attached, which skips the CAPTCHA and attributes the
// submission; already-contributed courses are skipped via the local
// submitted-records dedupe.

import type { Course } from "@/types/racing";
import type { LapSnapshot } from "@/lib/lapSnapshot";

/**
 * Submit one user-defined course to the community review queue.
 * Returns true when a submission was actually sent (false = nothing to add).
 */
export async function submitCustomCourse(
  trackName: string,
  courseName: string,
  course: Course,
): Promise<boolean> {
  if (!course.isUserDefined) return false;

  const [{ loadDefaultTracks }, { buildCourseSubmission }, { loadSubmittedRecords, markCoursesSubmitted }] =
    await Promise.all([
      import("@/lib/trackStorage"),
      import("@/lib/trackSubmission"),
      import("@/lib/submittedTracksStorage"),
    ]);

  const defaults = await loadDefaultTracks();
  const sub = buildCourseSubmission(trackName, courseName, course, defaults);
  if (!sub) return false; // identical to a built-in course — nothing to add

  // Skip if this exact content was already contributed.
  if (loadSubmittedRecords()[sub.key]?.hash === sub.contentHash) return false;

  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("submit-track", {
    body: {
      submissions: [{
        type: sub.type,
        track_name: sub.trackName,
        track_short_name: sub.type === "new_track" ? sub.trackShortName : undefined,
        course_name: sub.courseName,
        course_data: sub.courseData,
        layout_data: sub.layout,
      }],
    },
  });
  if (error) throw error;

  const batchId = (data as { batch_id?: string } | null)?.batch_id ?? `local-${Date.now()}`;
  markCoursesSubmitted([sub], batchId);
  return true;
}

/** Returns true when a track submission was actually sent (false = nothing to add). */
export async function autoSubmitSnapshotTrack(snap: LapSnapshot): Promise<boolean> {
  if (!snap.course?.isUserDefined) return false;
  return submitCustomCourse(snap.trackName, snap.courseName, snap.course);
}
