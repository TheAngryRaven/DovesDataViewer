/**
 * Contact-form submission (plan 0013 follow-up).
 *
 * Extracted from ContactDialog so the payload building is testable and so the
 * dialog can optionally attach the current session's datalog (plus the track it
 * was analysed against — plan 0019): plain messages
 * keep the original JSON contract; messages with an attachment go multipart
 * (same shape as parse-error reports — the edge function branches on
 * content-type). Plain `fetch` + VITE_SUPABASE_PROJECT_ID keeps Supabase off
 * the eager graph (ContactDialog is on the landing payload).
 */

import { prepareAttachment, appendAttachment } from "./parseReport";

export interface ContactMessageInput {
  category: string;
  message: string;
  email?: string;
  /** Optional datalog to attach (the current session's file). */
  attachment?: { blob: Blob; name: string };
  /**
   * Optional track bundle riding with the datalog (plan 0019) — the course
   * geometry the session was analysed against, which the log alone doesn't
   * carry. Uploaded as a second, `track`-prefixed attachment.
   */
  trackAttachment?: { blob: Blob; name: string };
}

export type ContactMessageResult =
  | { ok: true }
  | { ok: false; reason: "too-large" | "network" | "server"; serverError?: string };

/**
 * Build the request body: JSON without an attachment (the original contract),
 * multipart with one. Exported for tests.
 */
export async function buildContactBody(
  input: ContactMessageInput,
): Promise<{ body: string | FormData; contentType?: string } | "too-large"> {
  if (!input.attachment && !input.trackAttachment) {
    return {
      body: JSON.stringify({
        category: input.category,
        email: input.email?.trim() || null,
        message: input.message.trim(),
      }),
      contentType: "application/json",
    };
  }

  const form = new FormData();
  form.set("category", input.category);
  form.set("message", input.message.trim());
  if (input.email?.trim()) form.set("email", input.email.trim());

  if (input.attachment) {
    const prepared = await prepareAttachment(input.attachment.blob, input.attachment.name);
    if (prepared === "too-large") return "too-large";
    appendAttachment(form, prepared);
  }
  if (input.trackAttachment) {
    const preparedTrack = await prepareAttachment(input.trackAttachment.blob, input.trackAttachment.name);
    if (preparedTrack === "too-large") return "too-large";
    appendAttachment(form, preparedTrack, "track");
  }
  // No explicit contentType — the browser sets the multipart boundary.
  return { body: form };
}

export async function submitContactMessage(input: ContactMessageInput): Promise<ContactMessageResult> {
  const built = await buildContactBody(input);
  if (built === "too-large") return { ok: false, reason: "too-large" };

  try {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/submit-message`, {
      method: "POST",
      headers: built.contentType ? { "Content-Type": built.contentType } : undefined,
      body: built.body,
    });
    if (!resp.ok) {
      let serverError: string | undefined;
      try {
        serverError = (await resp.json()).error;
      } catch {
        // non-JSON error body — fall through with the generic reason
      }
      return { ok: false, reason: resp.status === 413 ? "too-large" : "server", serverError };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "network" };
  }
}
