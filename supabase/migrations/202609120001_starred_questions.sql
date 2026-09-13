-- same3le starred questions
-- Stores only the saved deck reference plus the Google Sheet source-row number.
-- It intentionally does NOT store question text, answer text, transcripts,
-- filenames, raw Sheet URLs, spreadsheet IDs, audio, PHI, or other study content.

create table if not exists public.starred_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_source_id uuid not null references public.saved_sources(id) on delete cascade,
  source_row integer not null,
  created_at timestamptz not null default now(),
  constraint starred_questions_source_row_positive check (source_row > 0),
  unique (user_id, saved_source_id, source_row)
);

create index if not exists starred_questions_user_source_idx
  on public.starred_questions (user_id, saved_source_id, source_row);

alter table public.starred_questions enable row level security;

create policy "Users read own starred questions"
on public.starred_questions for select
to authenticated
using (auth.uid() = user_id);

create policy "Users create stars for own saved sources"
on public.starred_questions for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.saved_sources source
    where source.id = saved_source_id
      and source.user_id = auth.uid()
  )
);

create policy "Users delete own starred questions"
on public.starred_questions for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, delete on table public.starred_questions to authenticated;
grant select on table public.starred_questions to anon;
grant select, insert, update, delete on table public.starred_questions to service_role;

comment on table public.starred_questions is
  'Minimal per-user starred-question references for saved Google Sheets. Stores saved_source_id and source_row only; never study content.';
