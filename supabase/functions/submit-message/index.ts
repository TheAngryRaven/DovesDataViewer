import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const ALLOWED_CATEGORIES = ["Comment", "Feature Request", "Complaint", "Bug Report", "New Datalogger Connection"];

// Attachment cap — keep in sync with MAX_UPLOAD_BYTES in src/lib/parseReport.ts
// and the submit-parse-report function.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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
    // Plain messages arrive as JSON (the original contract); messages with a
    // session-file attachment arrive as multipart form data (plan 0013).
    let category: unknown, email: unknown, message: unknown;
    let file: File | null = null;
    let compression: string | null = null;
    let fileName = '';
    let fileSize = 0;
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      category = form.get('category');
      email = form.get('email');
      message = form.get('message');
      const upload = form.get('file');
      if (upload instanceof File && upload.size > 0) {
        if (upload.size > MAX_UPLOAD_BYTES) {
          return new Response(JSON.stringify({ error: 'File too large' }), {
            status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        file = upload;
        compression = String(form.get('compression') ?? '') === 'gzip' ? 'gzip' : null;
        fileName = sanitizeFileName(String(form.get('fileName') ?? upload.name));
        const claimedSize = Number(form.get('fileSize'));
        fileSize = Number.isFinite(claimedSize) && claimedSize > 0
          ? Math.min(claimedSize, 1024 * 1024 * 1024)
          : upload.size;
      }
    } else {
      ({ category, email, message } = await req.json());
    }

    const categoryStr = typeof category === 'string' ? category : '';
    const emailStr = typeof email === 'string' ? email.trim() : '';
    const messageStr = typeof message === 'string' ? message.trim() : '';

    // Validate category
    if (!categoryStr || !ALLOWED_CATEGORIES.includes(categoryStr)) {
      return new Response(JSON.stringify({ error: 'Invalid category' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate message
    if (messageStr.length === 0) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (messageStr.length > 2000) {
      return new Response(JSON.stringify({ error: 'Message must be under 2000 characters' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate email format if provided
    if (emailStr.length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailStr) || emailStr.length > 255) {
        return new Response(JSON.stringify({ error: 'Invalid email address' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Get submitter IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               req.headers.get('cf-connecting-ip') || 'unknown';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Check if IP is banned
    const { data: banned } = await supabase
      .from('banned_ips')
      .select('id, expires_at')
      .eq('ip_address', ip)
      .maybeSingle();

    if (banned) {
      if (!banned.expires_at || new Date(banned.expires_at) > new Date()) {
        return new Response(JSON.stringify({ error: 'Your IP has been blocked.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      await supabase.from('banned_ips').delete().eq('id', banned.id);
    }

    // Rate limiting: max 3 messages per hour per IP
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('submitted_by_ip', ip)
      .gte('created_at', oneHourAgo);

    if (count !== null && count >= 3) {
      return new Response(JSON.stringify({ error: 'Too many messages. Please try again later.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Optional session-file attachment → private support-files bucket (shared
    // with parse-error reports; admin-only read/delete).
    let storagePath: string | null = null;
    if (file) {
      storagePath = `${crypto.randomUUID()}/${fileName}${compression ? '.gz' : ''}`;
      const bytes = await file.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from('support-files')
        .upload(storagePath, bytes, { contentType: 'application/octet-stream' });
      if (uploadError) throw uploadError;
    }

    // Insert message
    const { error } = await supabase.from('messages').insert({
      category: categoryStr,
      email: emailStr || null,
      message: messageStr,
      submitted_by_ip: ip,
      file_name: file ? fileName : null,
      file_size: file ? fileSize : null,
      storage_path: storagePath,
      compression: file ? compression : null,
    });

    if (error) {
      // Don't strand an orphan object if the row failed.
      if (storagePath) await supabase.storage.from('support-files').remove([storagePath]);
      throw error;
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('submit-message error:', e);
    return new Response(JSON.stringify({ error: 'An error occurred. Please try again later.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
