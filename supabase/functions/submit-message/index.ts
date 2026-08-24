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

interface Upload {
  file: File;
  fileName: string;
  fileSize: number;
  compression: string | null;
}

function tooLarge(): Response {
  return new Response(JSON.stringify({ error: 'File too large' }), {
    status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Read one `prefix`-namespaced attachment group out of the multipart body.
 * Returns null when the group is absent, 'too-large' when it blows the cap.
 */
function readUpload(form: FormData, prefix: string): Upload | null | 'too-large' {
  const field = (base: string) =>
    prefix ? `${prefix}${base[0].toUpperCase()}${base.slice(1)}` : base;
  const upload = form.get(field('file'));
  if (!(upload instanceof File) || upload.size === 0) return null;
  if (upload.size > MAX_UPLOAD_BYTES) return 'too-large';
  const claimedSize = Number(form.get(field('fileSize')));
  return {
    file: upload,
    fileName: sanitizeFileName(String(form.get(field('fileName')) ?? upload.name)),
    fileSize: Number.isFinite(claimedSize) && claimedSize > 0
      ? Math.min(claimedSize, 1024 * 1024 * 1024)
      : upload.size,
    compression: String(form.get(field('compression')) ?? '') === 'gzip' ? 'gzip' : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Plain messages arrive as JSON (the original contract); messages with a
    // session-file attachment arrive as multipart form data (plan 0013) —
    // optionally carrying the session's track bundle too (plan 0019).
    let category: unknown, email: unknown, message: unknown;
    let datalog: Upload | null = null;
    let trackFile: Upload | null = null;
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      category = form.get('category');
      email = form.get('email');
      message = form.get('message');
      // The datalog goes up unprefixed; the session's track bundle as
      // `trackFile`/`trackFileName`/… (plan 0019 — see src/lib/parseReport.ts).
      const parsed = readUpload(form, '');
      if (parsed === 'too-large') return tooLarge();
      datalog = parsed;
      const parsedTrack = readUpload(form, 'track');
      if (parsedTrack === 'too-large') return tooLarge();
      trackFile = parsedTrack;
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

    // Optional session attachments → private support-files bucket (shared with
    // parse-error reports; admin-only read/delete). The datalog and the track
    // bundle are separate objects so each downloads under its own name.
    const store = async (upload: Upload): Promise<string> => {
      const path = `${crypto.randomUUID()}/${upload.fileName}${upload.compression ? '.gz' : ''}`;
      const bytes = await upload.file.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from('support-files')
        .upload(path, bytes, { contentType: 'application/octet-stream' });
      if (uploadError) throw uploadError;
      return path;
    };

    const uploaded: string[] = [];
    let storagePath: string | null = null;
    let trackStoragePath: string | null = null;
    try {
      if (datalog) {
        storagePath = await store(datalog);
        uploaded.push(storagePath);
      }
      if (trackFile) {
        trackStoragePath = await store(trackFile);
        uploaded.push(trackStoragePath);
      }
    } catch (uploadError) {
      // Don't strand half an upload pair.
      if (uploaded.length > 0) await supabase.storage.from('support-files').remove(uploaded);
      throw uploadError;
    }

    // Insert message
    const { error } = await supabase.from('messages').insert({
      category: categoryStr,
      email: emailStr || null,
      message: messageStr,
      submitted_by_ip: ip,
      file_name: datalog?.fileName ?? null,
      file_size: datalog?.fileSize ?? null,
      storage_path: storagePath,
      compression: datalog?.compression ?? null,
      track_file_name: trackFile?.fileName ?? null,
      track_file_size: trackFile?.fileSize ?? null,
      track_storage_path: trackStoragePath,
      track_compression: trackFile?.compression ?? null,
    });

    if (error) {
      // Don't strand orphan objects if the row failed.
      if (uploaded.length > 0) await supabase.storage.from('support-files').remove(uploaded);
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
