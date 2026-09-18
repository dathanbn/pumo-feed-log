-- Pumo Feed Log: complete database setup (Supabase / Postgres). Safe to re-run.

-- ---- pets -----------------------------------------------------------------
create table if not exists public.pets (
  id          uuid        primary key default gen_random_uuid(),
  slug        text        not null unique,
  name        text        not null,
  species     text        not null check (species in ('cat', 'dog')),
  sort_order  int2        not null,
  photo_url   text        null
);

comment on table public.pets is
  'Pumo Feed Log. Fixed small list of household pets. Client is read-only.';

insert into public.pets (slug, name, species, sort_order, photo_url)
values
  ('pumo', 'Pumo', 'cat', 0, 'assets/pumo.jpg'),
  ('zuumi', 'Zuumi', 'cat', 1, 'assets/zuumi.jpg'),
  ('banh-mi', 'Banh Mi', 'dog', 2, 'assets/banh-mi.jpg')
on conflict (slug) do nothing;

-- v1.2: Zuumi and Banh Mi got real photos after the initial seed above (which is why the insert
-- has "do nothing" on conflict and doesn't retroactively fix already-seeded rows). Re-running this
-- file on a fresh project is fine — the insert already has the right URLs. On an existing project
-- that seeded them as null, this one-time backfill catches it up:
update public.pets set photo_url = 'assets/zuumi.jpg' where slug = 'zuumi' and photo_url is null;
update public.pets set photo_url = 'assets/banh-mi.jpg' where slug = 'banh-mi' and photo_url is null;

alter table public.pets enable row level security;
revoke all on table public.pets from anon, authenticated;
grant usage on schema public to anon;
grant select on table public.pets to anon;  -- anyone with the link can see the pet list

drop policy if exists pets_anon_select on public.pets;
create policy pets_anon_select on public.pets for select to anon using (true);
-- No insert/update/delete grant or policy: the pet list is fixed, edited only from the dashboard.

-- ---- feeds ------------------------------------------------------------------
create table if not exists public.feeds (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  logged_by   text        null,
  deleted_at  timestamptz null
);

comment on table public.feeds is
  'Pumo Feed Log. One row per feed, one pet per row. Soft delete only: deleted_at not null means deleted.';

-- v1.2: created_at can now be corrected by the client (a fixed-time edit, not just server-set at
-- insert). This DB-level backstop keeps it from ever landing in the future even via a direct API
-- call, bypassing the app's own "no future time" validation. 5 min covers normal clock skew.
alter table public.feeds drop constraint if exists feeds_created_at_not_future;
alter table public.feeds
  add constraint feeds_created_at_not_future
  check (created_at <= now() + interval '5 minutes');

-- Add pet_id if this is a migration from v1 (nullable at first, so the ALTER never fails on existing rows).
alter table public.feeds add column if not exists pet_id uuid references public.pets(id);

-- Backfill any pre-v1.1 rows (pet_id still null) to Pumo.
update public.feeds
set pet_id = (select id from public.pets where slug = 'pumo')
where pet_id is null;

-- Now that every row has a pet, make it required going forward.
alter table public.feeds alter column pet_id set not null;

-- Row Level Security on.
alter table public.feeds enable row level security;

-- Table privileges. Newer Supabase projects no longer grant these automatically, so set them explicitly.
revoke all on table public.feeds from anon, authenticated;
grant usage on schema public to anon;
grant select on table public.feeds to anon;                          -- anyone with the link can read
grant insert (id, pet_id, logged_by) on table public.feeds to anon;  -- created_at is always the server's now() at insert time
grant update (deleted_at, created_at) on table public.feeds to anon; -- soft delete, and (v1.2) correcting a feed's logged time
-- Deliberately no DELETE grant: rows can never be hard-deleted through the API.
-- Deliberately no update grant on pet_id or logged_by: which pet and who fed them are never editable.

-- Permissive RLS policies for the anon role.
drop policy if exists feeds_anon_select on public.feeds;
create policy feeds_anon_select on public.feeds for select to anon using (true);

drop policy if exists feeds_anon_insert on public.feeds;
create policy feeds_anon_insert on public.feeds for insert to anon with check (true);

drop policy if exists feeds_anon_update on public.feeds;
create policy feeds_anon_update on public.feeds for update to anon using (true) with check (true);
-- Deliberately no DELETE policy.

create index if not exists feeds_pet_id_created_at_idx on public.feeds (pet_id, created_at desc);
