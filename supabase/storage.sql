-- Dot Trading Post — listing photos.
--
-- Run this in the Supabase SQL editor AFTER schema.sql. Order relative to wallets.sql and
-- privacy.sql does not matter.
--
-- Photos live in a public storage bucket, and the listing row carries their URLs. Public read is
-- the point of a board; the policies below are about who may PUT things there: only a signed-in
-- person, only under a folder named after their own id, and only they may remove what they put.
-- That folder rule is what stops one person overwriting or deleting another's pictures.
--
-- Nothing here strips location data. That happens in the browser before upload (site/photos.js),
-- because by the time bytes reach the bucket they are already public. Phone photos carry GPS
-- coordinates in EXIF, and a board that re-publishes them is handing out home addresses.

alter table public.items
  add column if not exists photos text[] not null default '{}';

-- Up to four photos a listing. A hard cap in the schema, not just the form.
alter table public.items drop constraint if exists items_photos_max;
alter table public.items add constraint items_photos_max check (coalesce(array_length(photos, 1), 0) <= 4);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "photos are public" on storage.objects;
create policy "photos are public" on storage.objects for select
  using (bucket_id = 'photos');

-- The first path segment must be the uploader's own user id.
drop policy if exists "upload into own folder" on storage.objects;
create policy "upload into own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "remove own photos" on storage.objects;
create policy "remove own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Proof-of-item photos: private. Only their uploader can read them back; the verify-item Edge
-- Function reads them with the service role. Nothing about them is public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "upload proof into own folder" on storage.objects;
create policy "upload proof into own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "read own proofs" on storage.objects;
create policy "read own proofs" on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);

-- The listing-photo read policy must not cover proofs: it is scoped to bucket 'photos' above.

-- Photo reads: each time the post form asks the vision function to suggest a title from a photo.
-- Only the function (service role) writes or reads it; it is how the daily allowance is counted.
create table if not exists public.photo_reads (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists photo_reads_user_idx on public.photo_reads (user_id, created_at);
alter table public.photo_reads enable row level security;
-- Old reads are only counted for a day; keep a week for looking into abuse, then let them go.
delete from public.photo_reads where created_at < now() - interval '7 days';
