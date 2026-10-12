create extension if not exists pgcrypto;

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  ig_user_id text not null,
  username text not null,
  page_id text,
  access_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, user_id, ig_user_id)
);

create table if not exists public.instagram_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  media_url text not null,
  caption text not null default '',
  scheduled_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'publishing', 'published', 'failed')),
  instagram_creation_id text,
  instagram_media_id text,
  published_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists instagram_posts_due_idx
  on public.instagram_posts (scheduled_at)
  where status = 'scheduled';

create index if not exists instagram_posts_user_idx
  on public.instagram_posts (user_id, scheduled_at desc);

alter table public.social_accounts enable row level security;
alter table public.instagram_posts enable row level security;

drop policy if exists "Users can read own social accounts" on public.social_accounts;
create policy "Users can read own social accounts"
  on public.social_accounts for select
  using (auth.uid() = user_id);

drop policy if exists "Users can read own instagram posts" on public.instagram_posts;
create policy "Users can read own instagram posts"
  on public.instagram_posts for select
  using (auth.uid() = user_id);
