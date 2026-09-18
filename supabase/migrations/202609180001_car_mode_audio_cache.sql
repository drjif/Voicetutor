create table if not exists public.car_audio_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_source_id uuid not null references public.saved_sources(id) on delete cascade,
  source_row integer not null check (source_row > 0),
  question_hash text not null,
  question_path text not null,
  answer_hash text not null,
  answer_path text not null,
  model text not null default 'fish-audio/s2.1-pro-free',
  voice text not null default '933563129e564b19a115bedd57b7406a',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, saved_source_id, source_row)
);

alter table public.car_audio_assets enable row level security;

drop policy if exists "Users can read own car audio metadata" on public.car_audio_assets;
create policy "Users can read own car audio metadata"
on public.car_audio_assets for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own car audio metadata" on public.car_audio_assets;
create policy "Users can insert own car audio metadata"
on public.car_audio_assets for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.saved_sources s
    where s.id = saved_source_id and s.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can update own car audio metadata" on public.car_audio_assets;
create policy "Users can update own car audio metadata"
on public.car_audio_assets for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.saved_sources s
    where s.id = saved_source_id and s.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can delete own car audio metadata" on public.car_audio_assets;
create policy "Users can delete own car audio metadata"
on public.car_audio_assets for delete
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists car_audio_assets_source_idx
on public.car_audio_assets (user_id, saved_source_id, source_row);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('car-audio', 'car-audio', false, 10485760, array['audio/mpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read own car audio files" on storage.objects;
create policy "Users can read own car audio files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'car-audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can upload own car audio files" on storage.objects;
create policy "Users can upload own car audio files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'car-audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can update own car audio files" on storage.objects;
create policy "Users can update own car audio files"
on storage.objects for update
to authenticated
using (
  bucket_id = 'car-audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'car-audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can delete own car audio files" on storage.objects;
create policy "Users can delete own car audio files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'car-audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
