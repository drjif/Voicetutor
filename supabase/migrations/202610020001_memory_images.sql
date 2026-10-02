create table if not exists public.memory_image_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_source_id uuid not null references public.saved_sources(id) on delete cascade,
  source_row integer not null check (source_row > 0),
  question_hash text not null check (question_hash ~ '^[a-f0-9]{64}$'),
  question_text text not null,
  answer_text text not null,
  image_hash text not null check (image_hash ~ '^[a-f0-9]{64}$'),
  storage_path text not null,
  mime_type text not null check (mime_type in ('image/webp', 'image/jpeg')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 1048576),
  width integer not null check (width > 0 and width <= 2000),
  height integer not null check (height > 0 and height <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, saved_source_id, source_row)
);

alter table public.memory_image_assets enable row level security;

grant select, insert, update, delete on public.memory_image_assets to authenticated;

drop policy if exists "Users can read own memory image metadata" on public.memory_image_assets;
create policy "Users can read own memory image metadata"
on public.memory_image_assets for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own memory image metadata" on public.memory_image_assets;
create policy "Users can insert own memory image metadata"
on public.memory_image_assets for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.saved_sources s
    where s.id = saved_source_id
      and s.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can update own memory image metadata" on public.memory_image_assets;
create policy "Users can update own memory image metadata"
on public.memory_image_assets for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.saved_sources s
    where s.id = saved_source_id
      and s.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can delete own memory image metadata" on public.memory_image_assets;
create policy "Users can delete own memory image metadata"
on public.memory_image_assets for delete
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists memory_image_assets_source_idx
on public.memory_image_assets (user_id, saved_source_id, source_row);

create index if not exists memory_image_assets_hash_idx
on public.memory_image_assets (user_id, image_hash);

create index if not exists memory_image_assets_storage_path_idx
on public.memory_image_assets (user_id, storage_path);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memory-images',
  'memory-images',
  false,
  1048576,
  array['image/webp', 'image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read own memory image files" on storage.objects;
create policy "Users can read own memory image files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'memory-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can upload own memory image files" on storage.objects;
create policy "Users can upload own memory image files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'memory-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can update own memory image files" on storage.objects;
create policy "Users can update own memory image files"
on storage.objects for update
to authenticated
using (
  bucket_id = 'memory-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'memory-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can delete own memory image files" on storage.objects;
create policy "Users can delete own memory image files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'memory-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
