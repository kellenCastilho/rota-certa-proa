-- Install only after validating in a test database. Does not change delivery quotas.
begin;
alter table public.darota_plan_accounts add column if not exists google_test_enabled boolean not null default false;
create table public.darota_google_subscriptions (
 purchase_token text primary key check(length(purchase_token) between 10 and 4096),
 user_id uuid not null references auth.users(id) on delete cascade,
 test_purchase boolean not null, status text not null,
 premium_until timestamptz, checked_at timestamptz not null
);
create index darota_google_by_user on public.darota_google_subscriptions(user_id);
alter table public.darota_google_subscriptions enable row level security;
revoke all on public.darota_google_subscriptions from public, anon, authenticated;
grant all on public.darota_google_subscriptions to service_role;

create function public.darota_recompute_premium(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare account public.darota_plan_accounts%rowtype; until_date timestamptz;
begin
 insert into public.darota_plan_accounts(user_id) values(p_user_id) on conflict do nothing;
 select * into account from public.darota_plan_accounts where user_id=p_user_id for update;
 select max(s.premium_until) into until_date from (
  select premium_until from public.darota_apple_subscriptions where user_id=p_user_id and (environment='Production' or account.sandbox_enabled)
  union all
  select premium_until from public.darota_google_subscriptions where user_id=p_user_id and (not test_purchase or account.google_test_enabled)
 ) s;
 update public.darota_plan_accounts set premium_until=until_date where user_id=p_user_id;
 return jsonb_build_object('premium',coalesce(until_date>now(),false),'premiumUntil',until_date);
end; $$;
revoke all on function public.darota_recompute_premium(uuid) from public, anon, authenticated;
grant execute on function public.darota_recompute_premium(uuid) to service_role;

create function public.darota_record_google_subscription(p_user_id uuid,p_token text,p_test boolean,p_status text,p_premium_until timestamptz,p_checked_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('Google:'||p_token,0));
 insert into public.darota_plan_accounts(user_id) values(p_user_id) on conflict do nothing;
 perform 1 from public.darota_plan_accounts where user_id=p_user_id for update;
 if exists(select 1 from public.darota_google_subscriptions where purchase_token=p_token and user_id<>p_user_id) then
  raise exception 'SUBSCRIPTION_OWNER_MISMATCH';
 end if;
 insert into public.darota_google_subscriptions values(p_token,p_user_id,p_test,p_status,p_premium_until,p_checked_at)
 on conflict(purchase_token) do update set test_purchase=excluded.test_purchase,status=excluded.status,
 premium_until=excluded.premium_until,checked_at=excluded.checked_at
 where public.darota_google_subscriptions.user_id=excluded.user_id and public.darota_google_subscriptions.checked_at<=excluded.checked_at;
 return public.darota_recompute_premium(p_user_id);
end; $$;
revoke all on function public.darota_record_google_subscription(uuid,text,boolean,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.darota_record_google_subscription(uuid,text,boolean,text,timestamptz,timestamptz) to service_role;

-- Keep the Apple RPC signature intact for the submitted iOS build.
create or replace function public.darota_record_apple_subscription(p_user_id uuid,p_original_id text,p_environment text,p_transaction_id text,p_status integer,p_premium_until timestamptz,p_checked_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_environment||':'||p_original_id,0));
 insert into public.darota_plan_accounts(user_id) values(p_user_id) on conflict do nothing;
 perform 1 from public.darota_plan_accounts where user_id=p_user_id for update;
 if exists(select 1 from public.darota_apple_subscriptions where environment=p_environment and original_transaction_id=p_original_id and user_id<>p_user_id) then
  raise exception 'SUBSCRIPTION_OWNER_MISMATCH';
 end if;
 insert into public.darota_apple_subscriptions values(p_environment,p_original_id,p_user_id,p_transaction_id,p_status,p_premium_until,p_checked_at)
 on conflict(environment,original_transaction_id) do update set transaction_id=excluded.transaction_id,status=excluded.status,
 premium_until=excluded.premium_until,checked_at=excluded.checked_at
 where public.darota_apple_subscriptions.user_id=excluded.user_id and public.darota_apple_subscriptions.checked_at<=excluded.checked_at;
 return public.darota_recompute_premium(p_user_id);
end; $$;
commit;
