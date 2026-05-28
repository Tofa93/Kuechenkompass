create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  is_public boolean not null default false,
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

alter table public.recipes alter column user_id drop not null;
alter table public.recipes add column if not exists is_public boolean not null default false;
alter table public.recipes enable row level security;

drop policy if exists "Users can read their own recipes" on public.recipes;
drop policy if exists "Users can read visible recipes" on public.recipes;
create policy "Users can read visible recipes"
  on public.recipes
  for select
  using (is_public = true or auth.uid() = user_id);

drop policy if exists "Users can create their own recipes" on public.recipes;
create policy "Users can create their own recipes"
  on public.recipes
  for insert
  with check (auth.uid() = user_id and is_public = false);

drop policy if exists "Users can update their own recipes" on public.recipes;
create policy "Users can update their own recipes"
  on public.recipes
  for update
  using (auth.uid() = user_id and is_public = false)
  with check (auth.uid() = user_id and is_public = false);

drop policy if exists "Users can delete their own recipes" on public.recipes;
create policy "Users can delete their own recipes"
  on public.recipes
  for delete
  using (auth.uid() = user_id and is_public = false);

insert into public.recipes (
  id,
  user_id,
  is_public,
  title,
  note,
  category,
  time_minutes,
  servings,
  difficulty,
  prep_time_minutes,
  cook_time_minutes,
  ingredients,
  steps
) values
  (
    '11111111-1111-4111-8111-111111111111',
    null,
    true,
    'Gruene Pasta mit Zitrone',
    'Frisch, cremig und gut fuer volle Wochentage.',
    'Schnell',
    22,
    2,
    'Einfach',
    8,
    14,
    array['Pasta', 'Spinat', 'Zitrone', 'Parmesan'],
    'Pasta kochen. Spinat mit Zitronensaft und etwas Pastawasser kurz cremig mixen. Alles mit Parmesan vermengen und abschmecken.'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    null,
    true,
    'Ofengemuese mit Feta',
    'Ein Blech, wenig Abwasch, viel Farbe.',
    'Vegetarisch',
    40,
    3,
    'Einfach',
    15,
    25,
    array['Suesskartoffel', 'Paprika', 'Feta', 'Kichererbsen'],
    'Gemuese grob schneiden und mit Oel, Salz und Gewuerzen mischen. Auf einem Blech backen, Feta am Ende darueber broeseln.'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    null,
    true,
    'Tomatenreis fuer alle',
    'Mild, saettigend und gut vorzubereiten.',
    'Familie',
    35,
    4,
    'Einfach',
    10,
    25,
    array['Reis', 'Tomaten', 'Erbsen', 'Kraeuter'],
    'Reis mit Tomaten und Bruehe garen. Erbsen kurz vor Ende zugeben. Mit frischen Kraeutern und etwas Oel servieren.'
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    null,
    true,
    'Couscous-Box',
    'Kalt genauso stark wie warm.',
    'Meal Prep',
    18,
    2,
    'Einfach',
    12,
    6,
    array['Couscous', 'Gurke', 'Tomate', 'Joghurt'],
    'Couscous quellen lassen. Gemuese wuerfeln. Joghurt mit Salz, Zitrone und Kraeutern verruehren. Alles in Boxen schichten.'
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    null,
    true,
    'Pilzpfanne mit Kartoffeln',
    'Rustikal, herzhaft und unkompliziert.',
    'Vegetarisch',
    45,
    2,
    'Mittel',
    15,
    30,
    array['Kartoffeln', 'Champignons', 'Zwiebeln', 'Petersilie'],
    'Kartoffeln vorkochen und anbraten. Pilze und Zwiebeln separat kraeftig roesten. Zusammenfuehren und mit Petersilie abschliessen.'
  ),
  (
    '66666666-6666-4666-8666-666666666666',
    null,
    true,
    'Schnelle Linsensuppe',
    'Waermend und in einem Topf fertig.',
    'Schnell',
    28,
    3,
    'Einfach',
    8,
    20,
    array['Rote Linsen', 'Karotte', 'Kokosmilch', 'Curry'],
    'Karotte anschwitzen, Linsen und Curry zugeben. Mit Bruehe garen, Kokosmilch einruehren und cremig abschmecken.'
  )
on conflict (id) do update set
  is_public = excluded.is_public,
  title = excluded.title,
  note = excluded.note,
  category = excluded.category,
  time_minutes = excluded.time_minutes,
  servings = excluded.servings,
  difficulty = excluded.difficulty,
  prep_time_minutes = excluded.prep_time_minutes,
  cook_time_minutes = excluded.cook_time_minutes,
  ingredients = excluded.ingredients,
  steps = excluded.steps;

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
