// RSS 2.0 feed for the updates blog (plan 0012). Feed readers can't run the
// SPA's JavaScript and the site is served as static assets only, so the feed
// is rendered here. Reads published posts with the anon key — RLS is the gate.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = "https://lapwingdata.com";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// Mirror of the client's deriveExcerpt (lib/blogPosts.ts), trimmed to what a
// feed description needs: first real paragraph, markdown syntax stripped.
function excerpt(markdown: string, maxChars = 300): string {
  const lines = markdown.split(/\r?\n/);
  const paragraph: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (trimmed === "") { if (paragraph.length > 0) break; continue; }
    if (/^#{1,6}\s/.test(trimmed) || /^!\[[^\]]*\]\([^)]*\)$/.test(trimmed) || /^([-*_])\s*(\1\s*){2,}$/.test(trimmed)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed);
  }
  const text = paragraph
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^>\s?/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf(" ", maxChars);
  return `${text.slice(0, cut > 0 ? cut : maxChars).trimEnd()}…`;
}

interface FeedPost {
  slug: string;
  title: string;
  body: string;
  tags: string[] | null;
  published_at: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const { data, error } = await supabase
      .from('posts')
      .select('slug,title,body,tags,published_at')
      .eq('published', true)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(50);
    if (error) throw error;

    const posts = (data ?? []) as FeedPost[];
    const lastBuild = posts[0]?.published_at ?? new Date().toISOString();

    const items = posts.map((p) => {
      const url = `${SITE_URL}/updates/${p.slug}`;
      const categories = (p.tags ?? [])
        .map((tag) => `      <category>${escapeXml(tag)}</category>`)
        .join("\n");
      return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
${p.published_at ? `      <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>\n` : ""}      <description>${escapeXml(excerpt(p.body))}</description>
${categories ? categories + "\n" : ""}    </item>`;
    }).join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>LapWing Updates</title>
    <link>${SITE_URL}/updates</link>
    <atom:link href="${new URL(req.url).origin}${new URL(req.url).pathname}" rel="self" type="application/rss+xml"/>
    <description>News, release notes, and engineering write-ups from the LapWing telemetry viewer.</description>
    <language>en</language>
    <lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;

    return new Response(xml, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/rss+xml; charset=utf-8',
        // Feeds get polled aggressively; 15 min of edge caching is plenty fresh.
        'Cache-Control': 'public, max-age=900',
      },
    });
  } catch (e) {
    console.error('rss-feed error:', e);
    return new Response('Feed unavailable', {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
    });
  }
});
