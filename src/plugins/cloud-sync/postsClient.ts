// Untyped access to the posts table (plan 0012). Same pattern as
// leaderboardClient.ts: the generated Database type doesn't yet include
// `posts`, so route it through an untyped view of the shared client and
// hand-map rows (lib/blogPosts.ts). Public reads work for anonymous visitors
// (RLS allows anon select on published rows); writes are admin-only by RLS.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { mapPostRow, type BlogPost, type PostRow } from "@/lib/blogPosts";

const untyped = supabase as unknown as SupabaseClient;

export function postsTable() {
  return untyped.from("posts");
}

// ── Public (anon) reads ───────────────────────────────────────────────────────

// The explicit published filter matters even though anon RLS already hides
// drafts: for a signed-in admin the "Admins read all posts" policy also
// applies to these queries, so without it drafts would leak onto the public
// pages in the admin's own browser.

/** One row of the /updates index — everything the card needs, no full body. */
export interface PostListItem {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  aiAssisted: boolean;
  publishedAt: string | null;
  /** Leading slice of the markdown body (DB generated column) — excerpt source. */
  bodyPreview: string;
}

/**
 * Published posts for the index, newest first. Deliberately selects
 * `body_preview` rather than `body`: the listing only renders excerpts, and
 * pulling every post's full markdown would grow the page payload without
 * bound as the blog fills up.
 */
export async function fetchPublishedPostList(): Promise<PostListItem[]> {
  const { data, error } = await postsTable()
    .select("id,slug,title,tags,ai_assisted,published_at,body_preview")
    .eq("published", true)
    .order("published_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  const rows = (data ?? []) as Array<
    Pick<PostRow, "id" | "slug" | "title" | "tags" | "ai_assisted" | "published_at"> & {
      body_preview: string | null;
    }
  >;
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    tags: r.tags ?? [],
    aiAssisted: r.ai_assisted,
    publishedAt: r.published_at,
    bodyPreview: r.body_preview ?? "",
  }));
}

/** One published post by slug, or null when it doesn't exist (or is a draft). */
export async function fetchPostBySlug(slug: string): Promise<BlogPost | null> {
  const { data, error } = await postsTable()
    .select("*")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  if (error) throw error;
  return data ? mapPostRow(data as PostRow) : null;
}

/** Light row for the landing "latest updates" panels — no body payload. */
export interface PostSummary {
  slug: string;
  title: string;
  tags: string[];
  publishedAt: string | null;
}

/** Newest published posts, summaries only. The landing split happens client-side. */
export async function fetchLatestPostSummaries(limit = 50): Promise<PostSummary[]> {
  const { data, error } = await postsTable()
    .select("slug,title,tags,published_at")
    .eq("published", true)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as Array<Pick<PostRow, "slug" | "title" | "tags" | "published_at">>;
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    tags: r.tags ?? [],
    publishedAt: r.published_at,
  }));
}

// ── Admin ─────────────────────────────────────────────────────────────────────

/** Every post including drafts (admin RLS), newest created first. */
export async function fetchAllPostsAdmin(): Promise<BlogPost[]> {
  const { data, error } = await postsTable()
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as PostRow[]).map(mapPostRow);
}

export interface NewPost {
  slug: string;
  title: string;
  body: string;
  tags: string[];
  aiAssisted: boolean;
  published: boolean;
  publishedAt: string | null;
  authorId: string;
}

export async function createPost(post: NewPost): Promise<void> {
  const { error } = await postsTable().insert({
    slug: post.slug,
    title: post.title,
    body: post.body,
    tags: post.tags,
    ai_assisted: post.aiAssisted,
    published: post.published,
    published_at: post.publishedAt,
    author_id: post.authorId,
  });
  if (error) throw error;
}

export interface PostPatch {
  slug?: string;
  title?: string;
  body?: string;
  tags?: string[];
  aiAssisted?: boolean;
  published?: boolean;
  publishedAt?: string | null;
}

/** `updated_at` is maintained by the update_posts_updated_at trigger, not here. */
export async function updatePost(id: string, patch: PostPatch): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.slug !== undefined) row.slug = patch.slug;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.body !== undefined) row.body = patch.body;
  if (patch.tags !== undefined) row.tags = patch.tags;
  if (patch.aiAssisted !== undefined) row.ai_assisted = patch.aiAssisted;
  if (patch.published !== undefined) row.published = patch.published;
  if (patch.publishedAt !== undefined) row.published_at = patch.publishedAt;
  // An empty PATCH is a 400 from PostgREST, not a no-op.
  if (Object.keys(row).length === 0) return;
  const { error } = await postsTable().update(row).eq("id", id);
  if (error) throw error;
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await postsTable().delete().eq("id", id);
  if (error) throw error;
}

/** Postgres unique-violation (duplicate slug) — show the friendly message. */
export function isDuplicateSlugError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "23505" || /duplicate key/i.test(err?.message ?? "");
}
