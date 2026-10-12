-- Run after instagram-posting.sql. Server-only, atomic connection changes.
begin;

create or replace function public.disconnect_instagram_account(p_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('instagram-connection:' || p_user_id::text, 0));
  update public.social_accounts
    set access_token = '', updated_at = now()
    where user_id = p_user_id and provider = 'instagram';
  update public.instagram_posts
    set status = 'failed', error = 'Instagram disconnected. Create a new schedule after reconnecting.', updated_at = now()
    where user_id = p_user_id and status = 'scheduled'
      and social_account_id in (
        select id from public.social_accounts where user_id = p_user_id and provider = 'instagram'
      );
end;
$$;

create or replace function public.connect_instagram_account(
  p_user_id uuid, p_ig_user_id text, p_username text, p_access_token text, p_page_id text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user_id is null or coalesce(p_ig_user_id, '') = '' or coalesce(p_access_token, '') = ''
     or coalesce(p_username, '') = '' then
    raise exception 'Invalid Instagram connection';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('instagram-connection:' || p_user_id::text, 0));
  update public.social_accounts
    set access_token = '', updated_at = now()
    where user_id = p_user_id and provider = 'instagram' and ig_user_id <> p_ig_user_id;
  update public.instagram_posts
    set status = 'failed', error = 'Instagram account changed. Create a new schedule for the new account.', updated_at = now()
    where user_id = p_user_id and status = 'scheduled'
      and social_account_id in (
        select id from public.social_accounts
          where user_id = p_user_id and provider = 'instagram' and ig_user_id <> p_ig_user_id
      );
  insert into public.social_accounts (provider, user_id, ig_user_id, username, access_token, page_id)
    values ('instagram', p_user_id, p_ig_user_id, p_username, p_access_token, p_page_id)
    on conflict (provider, user_id, ig_user_id) do update
      set username = excluded.username, access_token = excluded.access_token,
          page_id = excluded.page_id, updated_at = now();
end;
$$;

revoke all on function public.disconnect_instagram_account(uuid) from public, anon, authenticated;
revoke all on function public.connect_instagram_account(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.disconnect_instagram_account(uuid) to service_role;
grant execute on function public.connect_instagram_account(uuid, text, text, text, text) to service_role;

commit;
