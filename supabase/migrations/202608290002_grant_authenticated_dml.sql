-- Table DML grants required by PostgREST / supabase-js.
-- Row Level Security stays enabled. These GRANTs only let a role attempt the
-- command; owner-only policies still decide which rows are visible.
-- Signed-out (anon) receives SELECT only, so queries return zero rows instead
-- of 42501, and still cannot INSERT/UPDATE/DELETE.

grant select, insert, update, delete on table public.saved_sources to authenticated;
grant select on table public.saved_sources to anon;

grant select, update on table public.profiles to authenticated;
grant select on table public.profiles to anon;

grant select, insert on table public.consent_records to authenticated;
grant select on table public.consent_records to anon;

grant select, insert, update on table public.marketing_preferences to authenticated;
grant select on table public.marketing_preferences to anon;

grant select on table public.subscription_entitlements to authenticated;
grant select on table public.subscription_entitlements to anon;

grant select, insert on table public.usage_events to authenticated;
grant select on table public.usage_events to anon;

grant select, insert on table public.account_deletion_requests to authenticated;
grant select on table public.account_deletion_requests to anon;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
