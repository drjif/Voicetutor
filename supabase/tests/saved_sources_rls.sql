-- Replayable Account Sync v1 RLS checks for public.saved_sources.
-- Run only against the verified same3le project in GIJAD Free.
-- These statements are a manual/security checklist, not an app migration.

-- 1. Signed-out / anonymous role cannot read saved sources.
set local role anon;
select public.saved_sources.id from public.saved_sources;
-- Expect: 0 rows or a permission error. Never another user's rows.

-- 2. Authenticated User A can insert and read User A rows.
-- Replace the JWT/uid with User A's session before running.
reset role;
-- select auth.uid();
-- insert into public.saved_sources (user_id, display_name, source_type, spreadsheet_id, sheet_gid)
-- values (auth.uid(), 'GI Boards', 'google-sheet', 'abcDEF123', '0');
-- select * from public.saved_sources where user_id = auth.uid();

-- 3. User A can update and delete only User A rows.
-- update public.saved_sources
-- set display_name = 'GI Boards renamed'
-- where user_id = auth.uid();
-- delete from public.saved_sources where user_id = auth.uid() and spreadsheet_id = 'abcDEF123';

-- 4. User A cannot read or modify User B rows.
-- While signed in as User A:
-- select * from public.saved_sources where user_id = '<user-b-uuid>';
-- update public.saved_sources set display_name = 'hijack' where user_id = '<user-b-uuid>';
-- delete from public.saved_sources where user_id = '<user-b-uuid>';
-- Expect: 0 rows affected / not visible.

-- 5. Confirm RLS remains enabled and policies are owner-scoped.
select c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'saved_sources';

select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as check_expr
from pg_policy
join pg_class c on c.oid = pg_policy.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'saved_sources';
