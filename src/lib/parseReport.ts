/**
 * Parse-error support reports (plan 0013).
 *
 * When a datalog fails to parse, the user can send the file + a message to the
 * support team via the `submit-parse-report` edge function. This module holds
 * the pure/testable pieces (sanitizing, sizing, gzip, form building) plus the
 * fetch itself. Deliberately uses plain `fetch` + VITE_SUPABASE_PROJECT_ID —
 * same pattern as ContactDialog — so nothing here drags the Supabase client
 * onto the eager landing-page graph.
 */

/** Upload ceiling — keep in sync with the edge function's MAX_UPLOAD_BYTES. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const MAX_REPORT_MESSAGE_CHARS = 2000;

/** Keep only a safe basename (mirrored server-side). */
export function sanitizeReportFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() || "datalog";
  return base.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "datalog";
}

/** Human-readable size for the dialog's "Attached:" line. */
export function formatReportFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Gzip a blob via CompressionStream. Returns null when the API is unavailable
 * or compression fails — the caller falls back to the raw file.
 */
export async function gzipBlob(blob: Blob): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
    return await new Response(stream).blob();
  } catch {
    return null;
  }
}

export interface ParseReportInput {
  file: File;
  message: string;
  email?: string;
  /** The parser exception message shown to the user. */
  errorText?: string;
  appVersion?: string;
  /** Supabase access token when signed in — attributes the report. */
  accessToken?: string;
}

export type ParseReportResult =
  | { ok: true }
  | { ok: false; reason: "too-large" | "network" | "server"; serverError?: string };

/**
 * Choose the payload to upload (gzipped when it actually helps) and build the
 * multipart body. Exported for tests; `submitParseReport` is the entry point.
 */
export async function buildParseReportForm(input: ParseReportInput): Promise<FormData | "too-large"> {
  const { file } = input;
  const gz = await gzipBlob(file);
  const useGzip = gz !== null && gz.size < file.size;
  const payload = useGzip ? gz : file;
  if (payload.size > MAX_UPLOAD_BYTES) return "too-large";

  const safeName = sanitizeReportFileName(file.name);
  const form = new FormData();
  form.set("message", input.message.trim());
  if (input.email?.trim()) form.set("email", input.email.trim());
  if (input.errorText) form.set("errorText", input.errorText.slice(0, MAX_REPORT_MESSAGE_CHARS));
  if (input.appVersion) form.set("appVersion", input.appVersion.slice(0, 100));
  form.set("fileName", safeName);
  form.set("fileSize", String(file.size));
  form.set("compression", useGzip ? "gzip" : "");
  form.set("file", payload, useGzip ? `${safeName}.gz` : safeName);
  return form;
}

export async function submitParseReport(input: ParseReportInput): Promise<ParseReportResult> {
  const form = await buildParseReportForm(input);
  if (form === "too-large") return { ok: false, reason: "too-large" };

  try {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const headers: Record<string, string> = {};
    if (input.accessToken) headers["Authorization"] = `Bearer ${input.accessToken}`;
    const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/submit-parse-report`, {
      method: "POST",
      headers,
      body: form,
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
