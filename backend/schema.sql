-- Pumo Feed Log: complete database setup (Supabase / Postgres). Safe to re-run.

create table if not exists public.feeds (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  logged_by   text        null,
  deleted_at  timestamptz null
);

comment on table public.feeds is
  'Pumo Feed Log. One row per feed. Soft delete only: deleted_at not null means deleted.';

-- Row Level Security on.
alter table public.feeds enable row level security;

-- Table privileges. Newer Supabase projects no longer grant these automatically, so set them explicitly.
revoke all on table public.feeds from anon, authenticated;
grant usage on schema public to anon;
grant select on table public.feeds to anon;                  -- anyone with the link can read
grant insert (id, logged_by) on table public.feeds to anon;  -- created_at is always the server's now()
grant update (deleted_at) on table public.feeds to anon;     -- the only edit allowed is soft delete
-- Deliberately no DELETE grant: rows can never be hard-deleted through the API.

-- Permissive RLS policies for the anon role.
drop policy if exists feeds_anon_select on public.feeds;
create policy feeds_anon_select on public.feeds for select to anon using (true);

drop policy if exists feeds_anon_insert on public.feeds;
create policy feeds_anon_insert on public.feeds for insert to anon with check (true);

drop policy if exists feeds_anon_update on public.feeds;
create policy feeds_anon_update on public.feeds for update to anon using (true) with check (true);
-- Deliberately no DELETE policy.
