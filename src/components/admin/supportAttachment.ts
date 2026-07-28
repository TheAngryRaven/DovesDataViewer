import { supabase } from "@/integrations/supabase/client";

/**
 * Shared admin-side handling of support-files attachments (plan 0013):
 * parse-error reports and contact messages store datalogs in the same private
 * bucket, gzipped client-side when it helped. Admin-only import — this module
 * touches the Supabase client, so it must never be pulled onto the eager graph.
 */

/**
 * Download a stored attachment via the admin's storage RLS, gunzip when the
 * client compressed it, and hand it to the browser under its original name.
 * Throws on storage errors — callers toast.
 */
export async function downloadSupportAttachment(
  storagePath: string,
  compression: string | null,
  fileName: string,
): Promise<void> {
  const { data, error } = await supabase.storage.from("support-files").download(storagePath);
  if (error || !data) throw error ?? new Error("empty download");

  let blob: Blob = data;
  if (compression === "gzip" && typeof DecompressionStream !== "undefined") {
    blob = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).blob();
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Remove a stored attachment. Returns the storage error message, or null on
 * success — callers keep the DB row when removal fails so nothing orphans.
 */
export async function removeSupportAttachment(storagePath: string): Promise<string | null> {
  const { error } = await supabase.storage.from("support-files").remove([storagePath]);
  return error ? error.message : null;
}
