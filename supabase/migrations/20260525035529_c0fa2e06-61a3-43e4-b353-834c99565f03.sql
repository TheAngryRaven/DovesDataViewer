alter function public.sync_record_size(text, jsonb) set search_path = public;
alter function public.sync_storage_type(text) set search_path = public;
alter function public.enforce_sync_quota() set search_path = public;
alter function public.sync_storage_usage() set search_path = public;