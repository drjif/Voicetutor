-- samme3le production account foundation
-- Apply only after the legal operator, privacy contacts, retention schedule,
-- Supabase project URLs, and payment provider are finalized.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  acceptable_use_version text not null,
  age_18_confirmed boolean not null,
  us_access_confirmed boolean not null,
  marketing_consent boolean not null default false,
  accepted_at timestamptz not null default now(),
  client_context jsonb not null default '{}'::jsonb,
  constraint consent_client_context_is_object check (jsonb_typeof(client_context) = 'object')
);

create table if not exists public.marketing_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  subscribed boolean not null default false,
  source text not null default 'account',
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'paused')),
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check (event_name in (
    'demo_started',
    'demo_completed',
    'personal_question_bank_loaded',
    'personal_session_started',
    'personal_session_completed',
    'completed_10_questions',
    'returned_within_7_days',
    'would_pay_for_pro',
    'not_ready_to_pay'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint usage_details_is_object check (jsonb_typeof(details) = 'object')
);

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'denied')),
  completed_at timestamptz
);

create index if not exists consent_records_user_id_accepted_at_idx
  on public.consent_records (user_id, accepted_at desc);
create index if not exists usage_events_user_id_created_at_idx
  on public.usage_events (user_id, created_at desc);
create index if not exists usage_events_name_created_at_idx
  on public.usage_events (event_name, created_at desc);
create index if not exists account_deletion_requests_user_id_requested_at_idx
  on public.account_deletion_requests (user_id, requested_at desc);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger marketing_preferences_set_updated_at
before update on public.marketing_preferences
for each row execute function public.set_updated_at();

create trigger subscription_entitlements_set_updated_at
before update on public.subscription_entitlements
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.consent_records enable row level security;
alter table public.marketing_preferences enable row level security;
alter table public.subscription_entitlements enable row level security;
alter table public.usage_events enable row level security;
alter table public.account_deletion_requests enable row level security;

create policy "Users read own profile"
on public.profiles for select
to authenticated
using (auth.uid() = user_id);

create policy "Users update own profile"
on public.profiles for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users read own consent history"
on public.consent_records for select
to authenticated
using (auth.uid() = user_id);

create policy "Users append own consent records"
on public.consent_records for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users read own marketing preference"
on public.marketing_preferences for select
to authenticated
using (auth.uid() = user_id);

create policy "Users create own marketing preference"
on public.marketing_preferences for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users update own marketing preference"
on public.marketing_preferences for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users read own entitlement"
on public.subscription_entitlements for select
to authenticated
using (auth.uid() = user_id);

create policy "Users insert own usage event"
on public.usage_events for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users read own usage events"
on public.usage_events for select
to authenticated
using (auth.uid() = user_id);

create policy "Users create own deletion request"
on public.account_deletion_requests for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users read own deletion requests"
on public.account_deletion_requests for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.marketing_preferences (user_id, subscribed, source)
  values (new.id, false, 'account')
  on conflict (user_id) do nothing;

  insert into public.subscription_entitlements (user_id, plan, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

comment on table public.consent_records is
  'Append-only records of legal acceptance and separate optional marketing consent.';
comment on table public.subscription_entitlements is
  'Server-managed plan status. Browser clients may read their own row but may not write it.';
comment on table public.usage_events is
  'Minimized product events. Do not include question text, answers, transcripts, Sheet URLs, precise location, or sensitive data in details.';
