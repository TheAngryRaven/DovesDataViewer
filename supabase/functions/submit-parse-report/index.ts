import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Plan 0013 — parse-error support reports. Multipart endpoint: a datalog that
// failed to parse + the user's message, stored in the private support-files
// bucket and the parse_error_reports table (service role — RLS has no insert
// policy on purpose). Anonymous submissions are allowed; a valid Authorization
// bearer token attributes the report to that user.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Upload ceiling — the client gzips datalogs first, so real-world files fit
// well under this. Keep in sync with MAX_UPLOAD_BYTES in src/lib/parseReport.ts.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 2000;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Keep only a safe basename (mirrors sanitizeReportFileName client-side). */
function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'datalog';
  return (base.replace(/[^\w.\- ()]/g, '_').slice(0, 120)) || 'datalog';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const form = await req.formData();

    const message = String(form.get('message') ?? '').trim();
    if (!message) return json(400, { error: 'Message is required' });
    if (message.length > MAX_MESSAGE_CHARS) {
      return json(400, { error: `Message must be under ${MAX_MESSAGE_CHARS} characters` });
    }

    const email = String(form.get('email') ?? '').trim();
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email) || email.length > 255) {
        return json(400, { error: 'Invalid email address' });
      }
    }

    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return json(400, { error: 'File is required' });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return json(413, { error: 'File too large' });
    }

    const compression = String(form.get('compression') ?? '') === 'gzip' ? 'gzip' : null;
    const fileName = sanitizeFileName(String(form.get('fileName') ?? file.name));
    // Original (pre-compression) size, as reported by the client; fall back to
    // the upload's own size. Display-only, so clamp rather than reject.
    const claimedSize = Number(form.get('fileSize'));
    const fileSize = Number.isFinite(claimedSize) && claimedSize > 0
      ? Math.min(claimedSize, 1024 * 1024 * 1024)
      : file.size;
    const errorText = String(form.get('errorText') ?? '').trim().slice(0, MAX_MESSAGE_CHARS) || null;
    const appVersion = String(form.get('appVersion') ?? '').trim().slice(0, 100) || null;

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               req.headers.get('cf-connecting-ip') || 'unknown';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Banned-IP check (same policy as submit-message)
    const { data: banned } = await supabase
      .from('banned_ips')
      .select('id, expires_at')
      .eq('ip_address', ip)
      .maybeSingle();

    if (banned) {
      if (!banned.expires_at || new Date(banned.expires_at) > new Date()) {
        return json(403, { error: 'Your IP has been blocked.' });
      }
      await supabase.from('banned_ips').delete().eq('id', banned.id);
    }

    // Rate limiting: max 3 reports per hour per IP
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count } = await supabase
      .from('parse_error_reports')
      .select('id', { count: 'exact', head: true })
      .eq('submitted_by_ip', ip)
      .gte('created_at', oneHourAgo);

    if (count !== null && count >= 3) {
      return json(429, { error: 'Too many reports. Please try again later.' });
    }

    // Optional signed-in attribution — a bad/expired token just means anonymous.
    let userId: string | null = null;
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const { data } = await supabase.auth.getUser(authHeader.slice(7));
      userId = data.user?.id ?? null;
    }

    const storagePath = `${crypto.randomUUID()}/${fileName}${compression ? '.gz' : ''}`;
    const bytes = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from('support-files')
      .upload(storagePath, bytes, { contentType: 'application/octet-stream' });
    if (uploadError) throw uploadError;

    const { error: insertError } = await supabase.from('parse_error_reports').insert({
      message,
      email: email || null,
      error_text: errorText,
      app_version: appVersion,
      file_name: fileName,
      file_size: fileSize,
      storage_path: storagePath,
      compression,
      user_id: userId,
      submitted_by_ip: ip,
    });

    if (insertError) {
      // Don't strand an orphan object if the row failed.
      await supabase.storage.from('support-files').remove([storagePath]);
      throw insertError;
    }

    return json(200, { success: true });
  } catch (e) {
    console.error('submit-parse-report error:', e);
    return json(500, { error: 'An error occurred. Please try again later.' });
  }
});
