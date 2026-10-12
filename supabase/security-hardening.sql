-- Run once in Supabase SQL Editor after instagram-posting.sql; safe to rerun.
-- Remove client token access without changing account IDs or queued posts.
begin;

alter table public.social_accounts enable row level security;
revoke all privileges on table public.social_accounts from public, anon, authenticated;
revoke all privileges (id, provider, user_id, ig_user_id, username, page_id,
  access_token, created_at, updated_at)
  on table public.social_accounts from public, anon, authenticated;

grant select (id, provider, user_id, ig_user_id, username, page_id, created_at, updated_at)
  on table public.social_accounts to authenticated;

drop policy if exists "Users can read own social accounts" on public.social_accounts;
create policy "Users can read own social accounts"
  on public.social_accounts for select to authenticated
  using (auth.uid() = user_id);

-- Backend publishing keeps its existing service-role access.
grant all privileges on table public.social_accounts to service_role;

do $$
begin
  if has_column_privilege('authenticated', 'public.social_accounts', 'access_token', 'SELECT')
     or has_column_privilege('anon', 'public.social_accounts', 'access_token', 'SELECT') then
    raise exception 'Instagram token remains client-readable; inspect inherited grants';
  end if;
end $$;

-- Server-only atomic request ceilings, shared across production web replicas.
create schema if not exists clipmeme_private;
revoke all on schema clipmeme_private from public, anon, authenticated;
create table if not exists clipmeme_private.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  window_key bigint not null,
  used integer not null check (used > 0),
  primary key (user_id, operation, window_key)
);
alter table clipmeme_private.api_rate_limits enable row level security;
revoke all on table clipmeme_private.api_rate_limits from public, anon, authenticated;

create or replace function public.check_api_rate_limit(
  p_user_id uuid, p_operation text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  current_window bigint;
  admitted integer;
begin
  if p_limit < 1 or p_limit > 10000 or p_window_seconds <> 3600
     or p_operation not in ('upload', 'process', 'transcribe', 'publish', 'schedule', 'connect', 'download') then
    raise exception 'Invalid request limit';
  end if;
  current_window := floor(extract(epoch from now()) / p_window_seconds)::bigint;
  delete from clipmeme_private.api_rate_limits
    where user_id = p_user_id and window_key < current_window - 24;
  insert into clipmeme_private.api_rate_limits as counters (user_id, operation, window_key, used)
    values (p_user_id, p_operation, current_window, 1)
    on conflict (user_id, operation, window_key) do update
      set used = counters.used + 1 where counters.used < p_limit
    returning used into admitted;
  return admitted is not null;
end;
$$;
revoke all on function public.check_api_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_api_rate_limit(uuid, text, integer, integer) to service_role;

commit;
