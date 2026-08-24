# 0019 — Support messages carry the session's track data

## Goal / problem

The in-session help button (plan 0013 follow-up) lets a user attach the loaded
session's **datalog** to a contact message. That is only half of what a lap or
sector complaint needs: the datalog holds GPS samples and nothing else. Every
timing decision — where a lap starts, where sectors split, which course was
matched, whether the run was a sprint — comes from the user's **track data**,
which lives in *their* localStorage (`racing-datalog-tracks-v2`), not in the
file. Built-in tracks don't help either: the user may have moved a start/finish
line, added sub-sectors, drawn a layout, or created the course themselves.

The result was un-reproducible reports: "my laps are wrong" with a log that
parses perfectly and detects laps fine against *our* copy of the course.

So: when the help button attaches the session's log, it now attaches the track
the session was analysed against too.

## Approach & key decisions

**One toggle, two files.** The existing "attach the current session" switch now
sends both artifacts; there is no separate track switch. The two are only useful
together, and a second switch is a second thing to forget to turn on. The dialog
label says so, and the track line only appears when there *is* a track.

**A second attachment, not a merged bundle.** The datalog rides the multipart
body unprefixed (`file`, `fileName`, `fileSize`, `compression`); the track rides
the same request under a `track` prefix (`trackFile`, `trackFileName`, …).
`appendAttachment()` in `lib/parseReport.ts` grew a `prefix` argument and the
edge function grew the mirror-image `readUpload(form, prefix)`, so both sides
share one field-naming rule. Rejected alternatives:
- *Zip the pair into one object* — breaks the admin's plain "download the log"
  path and hides the track behind an extra unpack step.
- *Store the track JSON in a DB column* — a track with a drawn layout is
  hundreds of points; it belongs in the same private bucket as the log, under
  the same retention, not in a text column the admin list selects `*` from.

**Bundle contents** (`lib/supportTrackData.ts`, `SUPPORT_TRACK_KIND` /
`SUPPORT_TRACK_VERSION`): the stored `Track` (all its courses, sectors
normalized via `normalizeCourseSectors` so legacy `sector2`/`sector3` are folded
into the canonical list) **plus** the exact `Course` object the session was
using, kept as a separate field. They are usually the same object — but when
they differ (the user edited or deleted the course after loading the session)
that discrepancy is frequently the bug, so flattening them would destroy
evidence. Also stamped: the session filename (pairs the two attachments), the
track/course names, and the app version.

**Best-effort, never blocking.** The track is collected lazily on submit, and a
failure to read it (storage error, deleted track, waypoint-mode session with no
track at all) drops the attachment silently — the message and log still go out.
A report that fails to send because the *optional* half broke would be worse
than one without the track.

**Filename** — `<session basename>.track.json`, so the pair is obvious in the
admin list and on disk.

## Touch points

| Area | File |
|------|------|
| Bundle build + storage read | `src/lib/supportTrackData.ts` (+ `.test.ts`) |
| Multipart field prefixing | `src/lib/parseReport.ts` (`appendAttachment`) |
| Payload assembly | `src/lib/contactMessage.ts` (+ `.test.ts`) |
| Dialog (toggle + hint + submit) | `src/components/ContactDialog.tsx` |
| Session wiring (track + course) | `src/pages/Index.tsx` (`TabBar`) |
| Upload + row insert | `supabase/functions/submit-message/index.ts` |
| Columns + retention | `supabase/migrations/20260823000000_message_track_attachment.sql` |
| Admin download | `src/components/admin/MessagesTab.tsx` |
| Strings | `src/locales/*/landing.json`, `src/locales/*/admin.json` |

## Status

- [x] `lib/supportTrackData.ts` + Vitest coverage
- [x] Prefixed multipart attachments (client + edge function)
- [x] Dialog + Index wiring
- [x] Migration (`track_*` columns) folded into `purge_expired_personal_data()`
- [x] Admin "Download track" button
- [x] i18n (en + all shipped languages), changelog

### Future

- The parse-error report path (`ParseErrorReportDialog`) deliberately does *not*
  send track data: a file that failed to parse never reached course detection,
  so there is no track to send.
- Nothing imports the bundle back into the app yet — it is read by hand. The
  `kind`/`version` stamp exists so a "load support bundle" dev tool can be added
  without guessing at the shape.
