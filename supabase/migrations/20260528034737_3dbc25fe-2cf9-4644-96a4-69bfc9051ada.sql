alter table public.lap_snapshots alter column id set default gen_random_uuid();
alter table public.lap_snapshots alter column updated_at set default now();
notify pgrst, 'reload schema';