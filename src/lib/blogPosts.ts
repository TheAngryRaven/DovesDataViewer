// Updates blog helpers (plan 0011). Kept in lib/ (not the cloud-sync plugin) so
// they stay pure and unit-testable: types + row mapping, slug generation,
// excerpt derivation, and tag normalization. Supabase access lives in
// plugins/cloud-sync/postsClient.ts.

/** A `posts` row as returned by Supabase (snake_case, tags nullable). */
export interface PostRow {
  id: string;
  slug: string;
  title: string;
  body: string;
  tags: string[] | null;
  ai_assisted: boolean;
  published: boolean;
  published_at: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A blog post in app (camelCase) form. */
export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  body: string;
  tags: string[];
  aiAssisted: boolean;
  published: boolean;
  publishedAt: string | null;
  authorId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapPostRow(r: PostRow): BlogPost {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    body: r.body,
    tags: r.tags ?? [],
    aiAssisted: r.ai_assisted,
    published: r.published,
    publishedAt: r.published_at,
    authorId: r.author_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Slugs stay readable in a URL bar and stop growing at a word boundary. */
const SLUG_MAX_CHARS = 80;

/**
 * WordPress-style slug from a title: lowercase, diacritics stripped, any run
 * of non-alphanumerics collapsed to a single hyphen, capped at a hyphen
 * boundary. Returns "" for a title with no usable characters.
 */
export function slugify(title: string): string {
  let slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > SLUG_MAX_CHARS) {
    const cut = slug.lastIndexOf("-", SLUG_MAX_CHARS);
    slug = slug.slice(0, cut > 0 ? cut : SLUG_MAX_CHARS);
  }
  return slug;
}

/**
 * Plain-text excerpt from a markdown body: the first real paragraph with
 * markdown syntax stripped, word-boundary truncated to `maxChars`.
 * Headings, images, and code fences never count as the paragraph.
 */
export function deriveExcerpt(markdown: string, maxChars = 280): string {
  const lines = markdown.split(/\r?\n/);
  const paragraph: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const isBlank = trimmed === "";
    if (isBlank) {
      if (paragraph.length > 0) break; // paragraph complete
      continue;
    }
    // Skip headings, standalone images, and horizontal rules before the
    // first paragraph; a heading after text ends the paragraph instead.
    if (/^#{1,6}\s/.test(trimmed) || /^!\[[^\]]*\]\([^)]*\)$/.test(trimmed) || /^([-*_])\s*(\1\s*){2,}$/.test(trimmed)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed);
  }

  const text = paragraph
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "") // images gone entirely
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links keep their text
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

/** Trim, collapse inner whitespace, lowercase, drop empties, dedupe (order kept). */
export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of raw) {
    const clean = tag.trim().replace(/\s+/g, " ").toLowerCase();
    if (clean === "" || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

/** Sorted union of every tag used across `posts` — filter pills + suggestions. */
export function collectTags(posts: Array<{ tags: string[] }>): string[] {
  const all = new Set<string>();
  for (const post of posts) for (const tag of post.tags) all.add(tag);
  return [...all].sort((a, b) => a.localeCompare(b));
}
