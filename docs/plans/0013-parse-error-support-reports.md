# 0013 — Parse-error support reports (+ in-app help button)

## Problem

The first real-world Alfano 6 bug report (plan-less fix, PR #361) arrived by
email with the offending file attached by hand. There was no in-app path for
that: when a datalog fails to parse the user gets an error string and a dead
end, and once a user is *in* the app (session loaded) there is no way to reach
the contact form at all — `ContactDialog` only exists on the landing page.

## Goals

1. **Parse-failure diagnosis flow.** When `FileImport` fails to parse a file,
   offer an optional "Send this file to the support team for diagnosis"
   action. Works logged in or not. The user attaches a message (the form nags
   them to state which datalogger produced the file and how it was exported),
   an optional reply email, and the app auto-attaches the raw file, the parser
   error text, and the build version.
2. **Admin Support page.** A dedicated admin tab (separate from Messages)
   listing these reports with the attached file downloadable.
3. **Help button in the session view.** A LifeBuoy button in the `TabBar`
   (left of the overlay-visibility toggle) opening the existing
   `ContactDialog`, so logged-in / in-session users can always send a message.

## Design

### Data model (migration `20260728000000_parse_error_reports.sql`)

- `public.parse_error_reports`: `id`, `message` (required), `email`,
  `error_text` (the parser exception), `app_version`, `file_name` (original),
  `file_size` (original bytes), `storage_path` (bucket object), `compression`
  (`'gzip'` when the client compressed the upload), `user_id` (nullable FK →
  `auth.users`, set when the reporter was signed in), `is_read`,
  `created_at`, `submitted_by_ip`.
- RLS mirrors `messages`: admins (`has_role(…, 'admin')`) select/update/
  delete; **no insert policy** — inserts happen only through the edge
  function's service role.
- Private bucket `support-files` (uploads keyed `uuid/<sanitized name>`).
  Storage policies grant admins select + delete on the bucket; nothing else.

### Edge function `submit-parse-report`

Multipart POST, `verify_jwt = false` (anonymous reporting is the point).
Mirrors `submit-message`'s abuse controls: banned-IP check and 3/hour/IP rate
limit (counted on `parse_error_reports`). Validates message (≤2000 chars),
optional email, and the upload (≤20 MB — the platform's request ceiling;
client gzips first so real-world datalogs fit comfortably). If an
`Authorization: Bearer` token is present and resolves to a user, the report
is attributed via `user_id`. Uploads the file to `support-files`, then
inserts the row; the object is removed again if the insert fails.

### Client

- `src/lib/parseReport.ts` — pure/testable pieces: filename sanitizer, byte
  formatter, gzip helper (CompressionStream, graceful fallback to raw),
  FormData builder, and `submitParseReport()` which does the fetch (plain
  `fetch` + `VITE_SUPABASE_PROJECT_ID`, same as `ContactDialog` — keeps
  Supabase off the eager graph). The access token, when the user is signed
  in, comes from `AuthContext`'s session and rides as a header.
- `ParseErrorReportDialog` — `React.lazy` from `FileImport`, so the form
  costs nothing until a parse actually fails. Prefills email from the
  signed-in user.
- `FileImport` keeps the failed `File` + raw error message in state and
  renders the offer under the error line.
- `TabBar` (Index) grows a persistent right-side group: help button
  (ContactDialog) first, then the view-specific controls (overlay eye /
  split-graphs) so the help button sits left of the visibility toggle.

### Admin

`SupportTab` modeled on `MessagesTab` (filters, unread badge, expand to
read). Expanded view shows the message, parser error, app version, reporter
identity (email / user id / IP) and a download button for the stored file —
downloaded via the admin's storage RLS and decompressed client-side
(DecompressionStream) when `compression = 'gzip'`, restoring the original
filename. Delete removes the storage object first, then the row.

### Scope notes / future

- The report offer lives on the `FileImport` (landing import) path — the
  place new unsupported formats first fail. The file-manager reopen path
  (`useSessionData`) still just toasts; wiring the dialog there is a
  follow-up if it proves needed.
- Reports intentionally do **not** count against any user storage quota —
  they are support artifacts, admin-deletable, in their own private bucket.

## Follow-up: contact messages attach the session datalog

With a session loaded, the help button's ContactDialog offers a toggle to
attach the current session's file (fetched from IndexedDB only on submit).
`messages` grew nullable `file_name`/`file_size`/`storage_path`/`compression`
columns; `submit-message` accepts multipart alongside the original JSON
contract, storing into the same `support-files` bucket with the same caps.
`lib/contactMessage.ts` owns the payload building (shared attachment prep in
`lib/parseReport.ts`); `admin/supportAttachment.ts` centralizes admin
download/remove for both MessagesTab and SupportTab. The same migration folds
`parse_error_reports` + attached objects into `purge_expired_personal_data()`
so support artifacts follow the standard 90 d IP / 1 y content retention.

## Status

- [x] Migration + edge function + config.toml
- [x] `lib/parseReport.ts` + Vitest coverage
- [x] Dialog + FileImport wiring + TabBar help button
- [x] Admin SupportTab
- [x] i18n (en + all shipped languages), docs, changelog
- [x] Follow-up: session-file attachment on contact messages + retention wiring

> The attached session now also carries the track it was analysed against —
> see [plan 0019](0019-support-track-attachment.md).
