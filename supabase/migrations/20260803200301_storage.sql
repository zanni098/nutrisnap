-- Private bucket. Meal photos are a Pro feature; free users keep the existing
-- local data-URL thumbnail and never touch storage at all.
--
-- allowed_mime_types is a real control, not decoration: without it a client
-- can upload text/html into a bucket served from the project origin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meal-photos', 'meal-photos', false, 5242880,
  array['image/png', 'image/jpeg', 'image/webp']
);

-- Objects are keyed {user_id}/{meal_id}.webp, so the first path segment is the
-- owner. storage.foldername() returns that segment array.
--
-- The UPDATE policy needs both using and with check: using alone gates which
-- objects you may touch, not what you may rename them to — without with check
-- a user could move their own object into another user's folder.
create policy "meal_photos_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "meal_photos_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "meal_photos_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "meal_photos_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
