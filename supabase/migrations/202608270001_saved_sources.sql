-- samme3le Account Sync v1
-- Stores only reusable remote source references and lightweight progress metadata.
-- It intentionally does NOT store question text, answer text, uploaded files,
-- spoken audio, or transcripts.

create table if not exists public.saved_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  source_type text not null check (source_type in ('google-sheet')),
  spreadsheet_id text not null,
  sheet_gid text not null default '0',
  last_source_row integer,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_sources_display_name_length check (char_length(display_name) between 1 and 120),
  constraint saved_sources_spreadsheet_id_format check (spreadsheet_id ~ '^[A-Za-z0-9_-]+$'),
  constraint saved_sources_gid_format check (sheet_gid ~ '^[0-9]+$'),
  constraint saved_sources_last_source_row_positive check (last_source_row is null or last_source_row > 0),
  unique (user_id, source_type, spreadsheet_id, sheet_gid)
);

create index if not exists saved_sources_user_updated_at_idx
  on public.saved_sources (user_id, updated_at desc);

alter table public.saved_sources enable row level security;

create policy "Users read own saved sources"
on public.saved_sources for select
to authenticated
using (auth.uid() = user_id);

create policy "Users create own saved sources"
on public.saved_sources for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users update own saved sources"
on public.saved_sources for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users delete own saved sources"
on public.saved_sources for delete
to authenticated
using (auth.uid() = user_id);

create trigger saved_sources_set_updated_at
before update on public.saved_sources
for each row execute function public.set_updated_at();

comment on table public.saved_sources is
  'Account Sync v1: minimal references to reusable remote study sources. Do not store raw Sheet URLs, question text, answers, uploaded files, audio, transcripts, PHI, or confidential content here.';
