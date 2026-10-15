-- Run before enabling the manual-post feature. Does not change automatic posts.
begin;
create table if not exists public.instagram_manual_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) <= 200),
  caption text not null default '' check (length(caption) <= 2200),
  audio_url text not null default '', media_url text not null,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','notifying','awaiting_manual','completed','failed','skipped')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  lease_id uuid, lease_until timestamptz, email_sent_at timestamptz, completed_at timestamptz,
  error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists manual_posts_due_idx on public.instagram_manual_posts(scheduled_at)
  where status in ('scheduled','notifying');
create index if not exists manual_posts_owner_idx on public.instagram_manual_posts(user_id,scheduled_at desc);
alter table public.instagram_manual_posts enable row level security;
-- No direct browser writes; APIs enforce Pro, ownership, URL validation and state.
revoke all on public.instagram_manual_posts from anon, authenticated;
grant all on public.instagram_manual_posts to service_role;

create or replace function public.claim_manual_reminders(p_not_before timestamptz)
returns setof public.instagram_manual_posts
language plpgsql security definer set search_path = '' as $$
begin
  if p_not_before is null or p_not_before > now() then raise exception 'Invalid reminder activation cutoff'; end if;
  -- Do not replay old schedules after outages or activation. No email is sent here.
  update public.instagram_manual_posts set status='skipped', error='Reminder window missed; open the post manually', updated_at=now()
    where status in ('scheduled','notifying') and (lease_until is null or lease_until < now())
      and scheduled_at < greatest(p_not_before, now() - interval '15 minutes');
  update public.instagram_manual_posts set status='failed',error='Email reminder retries exhausted',updated_at=now()
    where status='notifying' and lease_until < now() and attempts >= 3;
  return query
    with candidates as (
      select id from public.instagram_manual_posts
      where scheduled_at between greatest(p_not_before,now() - interval '15 minutes') and now()
        and attempts < 3 and next_attempt_at <= now()
        and (status='scheduled' or (status='notifying' and lease_until < now()))
      order by scheduled_at limit 10 for update skip locked
    )
    update public.instagram_manual_posts as p set status='notifying', attempts=p.attempts+1,
      lease_id=gen_random_uuid(),lease_until=now()+interval '6 minutes',updated_at=now()
    from candidates as c where p.id=c.id returning p.*;
end;
$$;
revoke all on function public.claim_manual_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_manual_reminders(timestamptz) to service_role;
commit;
