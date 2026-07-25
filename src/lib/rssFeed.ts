// Updates-blog RSS feed URL (plan 0012). The feed is rendered by the rss-feed
// edge function (feed readers can't run the SPA), so the link follows whichever
// Supabase backend this build is baked against.
export const FEED_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rss-feed`;
