-- Follow-up performance hardening for starred_questions.
-- Adds a covering FK index and evaluates auth.uid() once per statement.

create index if not exists starred_questions_saved_source_idx
  on public.starred_questions (saved_source_id);

drop policy if exists "Users read own starred questions" on public.starred_questions;
create policy "Users read own starred questions"
on public.starred_questions for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users create stars for own saved sources" on public.starred_questions;
create policy "Users create stars for own saved sources"
on public.starred_questions for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.saved_sources source
    where source.id = saved_source_id
      and source.user_id = (select auth.uid())
  )
);

drop policy if exists "Users delete own starred questions" on public.starred_questions;
create policy "Users delete own starred questions"
on public.starred_questions for delete
to authenticated
using ((select auth.uid()) = user_id);
