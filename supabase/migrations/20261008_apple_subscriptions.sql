-- Billing storage only. Does not activate delivery quotas or modify deliveries.
begin;
create table if not exists public.darota_plan_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enforced boolean not null default false, premium_until timestamptz
);
alter table public.darota_plan_accounts add column if not exists sandbox_enabled boolean not null default false;
alter table public.darota_plan_accounts enable row level security;
revoke all on public.darota_plan_accounts from anon, authenticated;
grant select on public.darota_plan_accounts to authenticated;
grant all on public.darota_plan_accounts to service_role;
drop policy if exists darota_read_own_plan on public.darota_plan_accounts;
create policy darota_read_own_plan on public.darota_plan_accounts for select to authenticated using (user_id = (select auth.uid()));
create table public.darota_apple_subscriptions (
 environment text not null check (environment in ('Production','Sandbox')),
 original_transaction_id text not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 transaction_id text not null, status integer not null check (status between 1 and 5),
 premium_until timestamptz, checked_at timestamptz not null,
 primary key(environment, original_transaction_id)
);
alter table public.darota_apple_subscriptions enable row level security;
revoke all on public.darota_apple_subscriptions from anon, authenticated;
grant all on public.darota_apple_subscriptions to service_role;
create index darota_apple_by_user on public.darota_apple_subscriptions(user_id);
create function public.darota_record_apple_subscription(
 p_user_id uuid, p_original_id text, p_environment text, p_transaction_id text,
 p_status integer, p_premium_until timestamptz, p_checked_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare account public.darota_plan_accounts%rowtype; until_date timestamptz;
begin
 -- Serialize ownership checks for the same Apple chain across different accounts.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_environment || ':' || p_original_id, 0));
 insert into public.darota_plan_accounts(user_id) values(p_user_id) on conflict do nothing;
 select * into account from public.darota_plan_accounts where user_id=p_user_id for update;
 if exists (select 1 from public.darota_apple_subscriptions where environment=p_environment and original_transaction_id=p_original_id and user_id<>p_user_id) then
   raise exception 'SUBSCRIPTION_OWNER_MISMATCH';
 end if;
 insert into public.darota_apple_subscriptions values
 (p_environment,p_original_id,p_user_id,p_transaction_id,p_status,p_premium_until,p_checked_at)
 on conflict(environment,original_transaction_id) do update set
 transaction_id=excluded.transaction_id, status=excluded.status,
 premium_until=excluded.premium_until, checked_at=excluded.checked_at
 where public.darota_apple_subscriptions.user_id=excluded.user_id
 and public.darota_apple_subscriptions.checked_at<=excluded.checked_at;
 select max(s.premium_until) into until_date from public.darota_apple_subscriptions s
 where s.user_id=p_user_id and (s.environment='Production' or account.sandbox_enabled);
 update public.darota_plan_accounts set premium_until=until_date where user_id=p_user_id;
 return jsonb_build_object('premium',coalesce(until_date>now(),false),'premiumUntil',until_date);
end; $$;
revoke all on function public.darota_record_apple_subscription(uuid,text,text,text,integer,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.darota_record_apple_subscription(uuid,text,text,text,integer,timestamptz,timestamptz) to service_role;
commit;
