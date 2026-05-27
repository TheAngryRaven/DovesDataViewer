-- Add a "Premium" subscription tier.
--
-- Premium has the same storage as Pro (the paid logs ceiling) but no AI credits,
-- at a lower price — it slots between Plus and Pro. Tiers are data, so this is a
-- pure seed change on top of the catalogue introduced in the stripe-subscriptions
-- migration; no schema, trigger, or function changes are needed. Pro's sort_order
-- is bumped so the catalogue stays ordered free → plus → premium → pro.
--
-- NOTE: pricing + storage numbers here are provisional and expected to change.

insert into public.subscription_tiers
  (tier,      label,     price_cents, logs_bytes,  doc_bytes, ai_credits, sort_order) values
  ('premium', 'Premium',         300, 1073741824,    5242880,          0, 2)  -- 1 GB logs / 5 MB docs, no AI
on conflict (tier) do update set
  label       = excluded.label,
  price_cents = excluded.price_cents,
  logs_bytes  = excluded.logs_bytes,
  doc_bytes   = excluded.doc_bytes,
  ai_credits  = excluded.ai_credits,
  sort_order  = excluded.sort_order;

update public.subscription_tiers set sort_order = 3 where tier = 'pro';
