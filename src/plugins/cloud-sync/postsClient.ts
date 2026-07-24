// Untyped access to the posts table (plan 0011). Same pattern as
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

/** Published posts, newest first. RLS hides drafts — no client filter needed. */
export async function fetchPublishedPosts(): Promise<BlogPost[]> {
  const { data, error } = await postsTable()
    .select("*")
    .order("published_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return ((data ?? []) as PostRow[]).map(mapPostRow);
}

/** One published post by slug, or null when it doesn't exist (or is a draft). */
export async function fetchPostBySlug(slug: string): Promise<BlogPost | null> {
  const { data, error } = await postsTable().select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data ? mapPostRow(data as PostRow) : null;
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

export async function updatePost(id: string, patch: PostPatch): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.slug !== undefined) row.slug = patch.slug;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.body !== undefined) row.body = patch.body;
  if (patch.tags !== undefined) row.tags = patch.tags;
  if (patch.aiAssisted !== undefined) row.ai_assisted = patch.aiAssisted;
  if (patch.published !== undefined) row.published = patch.published;
  if (patch.publishedAt !== undefined) row.published_at = patch.publishedAt;
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
