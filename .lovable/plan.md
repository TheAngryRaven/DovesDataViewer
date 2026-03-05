

# Contact Form & Admin Messages

## Overview
Add a public contact form (accessible from the main page) that submits messages to a new `messages` table, and a new "Messages" tab in the admin panel to view/manage them. No auth required to submit — public-facing form similar to track submissions.

## Database

New table `messages`:
```sql
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  email text,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by_ip text
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins can select messages" ON public.messages FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update messages" ON public.messages FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete messages" ON public.messages FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));
```

Insert will happen via an edge function (like `submit-track`) to capture IP and avoid needing anon insert policies. Rate-limit: 3 messages per hour per IP.

## Edge Function: `submit-message`

- Validates category is in allowed list, email format (if provided), message length (max 2000 chars)
- Checks `banned_ips` table
- Rate limits by IP (3/hour via a simple count query on `messages.created_at`)
- Inserts into `messages` table with `submitted_by_ip`
- Returns success/error JSON

## New Files

### `src/components/ContactDialog.tsx`
A dialog with:
- Category dropdown: `["Comment", "Feature Request", "Complaint", "Bug Report"]` — defined as a const array for easy extension
- Email input (optional, placeholder "your@email.com for a reply")
- Message textarea (required, max 2000 chars)
- Submit button → calls `submit-message` edge function
- Toast on success/error

### `src/components/admin/MessagesTab.tsx`
- List of messages, newest first
- Filter: All / Unread / Read
- Each message shows: category badge, email (if any), date, preview
- Click to expand full message, marks as read
- Delete button per message
- Unread count badge on the tab trigger in Admin.tsx

## Modified Files

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add contact button (Mail icon) next to Privacy Policy link |
| `src/pages/Admin.tsx` | Add MessagesTab, update grid-cols-5 → grid-cols-6, add unread badge |
| `supabase/functions/submit-message/index.ts` | **New** — edge function for submission |
| `src/components/ContactDialog.tsx` | **New** — public contact form dialog |
| `src/components/admin/MessagesTab.tsx` | **New** — admin messages management |
| `CLAUDE.md` | Document new files |
| `README.md` | Note contact form feature |

## Key Details
- Categories array defined in a shared const so both the form and admin tab can reference it
- No Turnstile on this form (simpler than track submissions) — just IP rate limiting. Can add later if spam becomes an issue.
- The admin MessagesTab uses `supabase` client directly (same pattern as other admin tabs via `getDatabase()`) — but since `messages` isn't part of the `ITrackDatabase` interface and is admin-only, we'll query supabase directly in the component to keep it simple and avoid expanding the track DB abstraction unnecessarily.

