-- Run after instagram-connections.sql and manual-reminders.sql, before deployment.
-- Does not activate workers, retry old posts or disconnect existing accounts.
begin;
alter table public.instagram_posts add column if not exists group_id uuid;
alter table public.instagram_posts add column if not exists post_name text not null default '';
alter table public.instagram_posts add column if not exists delivery_kind text not null default 'scheduled';
create unique index if not exists instagram_posts_group_destination_idx
  on public.instagram_posts(user_id,group_id,social_account_id) where group_id is not null;
alter table public.instagram_manual_posts add column if not exists group_id uuid;
alter table public.instagram_manual_posts add column if not exists target_username text not null default '';
create unique index if not exists manual_posts_group_destination_idx
  on public.instagram_manual_posts(user_id,group_id,target_username) where group_id is not null;

create or replace function public.connect_instagram_account_multi(
  p_user_id uuid,p_ig_user_id text,p_username text,p_access_token text,p_page_id text default null
) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_user_id is null or coalesce(p_ig_user_id,'')='' or coalesce(p_access_token,'')='' or coalesce(p_username,'')='' then
    raise exception 'Invalid Instagram connection';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('instagram-connection:' || p_user_id::text,0));
  if not exists (select 1 from public.social_accounts where user_id=p_user_id and provider='instagram' and ig_user_id=p_ig_user_id and access_token<>'')
     and (select count(*) from public.social_accounts where user_id=p_user_id and provider='instagram' and access_token<>'') >= 3 then
    raise exception 'Maximum three Instagram accounts connected';
  end if;
  insert into public.social_accounts(provider,user_id,ig_user_id,username,access_token,page_id)
    values('instagram',p_user_id,p_ig_user_id,p_username,p_access_token,p_page_id)
    on conflict(provider,user_id,ig_user_id) do update set username=excluded.username,
      access_token=excluded.access_token,page_id=excluded.page_id,updated_at=now();
end $$;

create or replace function public.connect_instagram_account(
  p_user_id uuid,p_ig_user_id text,p_username text,p_access_token text,p_page_id text default null
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.connect_instagram_account_multi(p_user_id,p_ig_user_id,p_username,p_access_token,p_page_id);
end $$;
create or replace function public.instagram_multi_account_ready()
returns boolean language sql security definer set search_path='' as $$ select true $$;

create or replace function public.disconnect_instagram_account_target(p_user_id uuid,p_account_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('instagram-connection:' || p_user_id::text,0));
  if not exists (select 1 from public.social_accounts where id=p_account_id and user_id=p_user_id and provider='instagram') then
    raise exception 'Instagram account not found';
  end if;
  update public.social_accounts set access_token='',updated_at=now()
    where id=p_account_id and user_id=p_user_id and provider='instagram';
  update public.instagram_posts set status='failed',error='Instagram disconnected. Create a new schedule after reconnecting.',updated_at=now()
    where user_id=p_user_id and social_account_id=p_account_id and status='scheduled';
end $$;
revoke all on function public.connect_instagram_account(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.connect_instagram_account_multi(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.instagram_multi_account_ready() from public,anon,authenticated;
revoke all on function public.disconnect_instagram_account_target(uuid,uuid) from public,anon,authenticated;
grant execute on function public.connect_instagram_account(uuid,text,text,text,text) to service_role;
grant execute on function public.connect_instagram_account_multi(uuid,text,text,text,text) to service_role;
grant execute on function public.instagram_multi_account_ready() to service_role;
grant execute on function public.disconnect_instagram_account_target(uuid,uuid) to service_role;
commit;
-- Do not rerun the older instagram-connections.sql afterwards; it replaces accounts.
