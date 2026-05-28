create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  note text,
  category text not null,
  time_minutes integer not null default 0,
  servings integer not null default 1,
  difficulty text not null default 'Einfach',
  prep_time_minutes integer not null default 0,
  cook_time_minutes integer not null default 0,
  ingredients text[] not null default '{}',
  steps text not null,
  image_url text,
  created_at timestamptz not null default now()
);

alter table public.recipes enable row level security;

drop policy if exists "Users can read their own recipes" on public.recipes;
create policy "Users can read their own recipes"
  on public.recipes
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own recipes" on public.recipes;
create policy "Users can create their own recipes"
  on public.recipes
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own recipes" on public.recipes;
create policy "Users can update their own recipes"
  on public.recipes
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own recipes" on public.recipes;
create policy "Users can delete their own recipes"
  on public.recipes
  for delete
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('recipe-images', 'recipe-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Users can upload recipe images" on storage.objects;
create policy "Users can upload recipe images"
  on storage.objects
  for insert
  with check (
    bucket_id = 'recipe-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Recipe images are public" on storage.objects;
create policy "Recipe images are public"
  on storage.objects
  for select
  using (bucket_id = 'recipe-images');

drop policy if exists "Users can update their own recipe images" on storage.objects;
create policy "Users can update their own recipe images"
  on storage.objects
  for update
  using (
    bucket_id = 'recipe-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete their own recipe images" on storage.objects;
create policy "Users can delete their own recipe images"
  on storage.objects
  for delete
  using (
    bucket_id = 'recipe-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
