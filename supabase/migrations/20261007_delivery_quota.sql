-- Preparation only: all accounts start with enforced=false.
-- Never enable billing until real store purchases/renewals/restoration are verified.
begin;

create table if not exists public.darota_plan_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enforced boolean not null default false,
  premium_until timestamptz
);
create table if not exists public.darota_delivery_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  delivery_id uuid not null,
  usage_day date not null,
  primary key (user_id, delivery_id)
);
create index if not exists darota_usage_by_day
  on public.darota_delivery_usage(user_id, usage_day);
alter table public.darota_plan_accounts enable row level security;
alter table public.darota_delivery_usage enable row level security;
revoke all on public.darota_plan_accounts, public.darota_delivery_usage from anon, authenticated;
grant select on public.darota_plan_accounts, public.darota_delivery_usage to authenticated;
grant all on public.darota_plan_accounts, public.darota_delivery_usage to service_role;
drop policy if exists darota_read_own_plan on public.darota_plan_accounts;
create policy darota_read_own_plan on public.darota_plan_accounts
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists darota_read_own_usage on public.darota_delivery_usage;
create policy darota_read_own_usage on public.darota_delivery_usage
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.darota_quota_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  account public.darota_plan_accounts%rowtype;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  used_count integer;
begin
  if owner_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into account from public.darota_plan_accounts where user_id = owner_id;
  select count(*)::integer into used_count from public.darota_delivery_usage
    where user_id = owner_id and usage_day = today;
  return jsonb_build_object(
    'enforced', coalesce(account.enforced, false),
    'premium', coalesce(account.premium_until > now(), false),
    'used', used_count, 'day', today, 'timezone', 'America/Sao_Paulo'
  );
end;
$$;
revoke all on function public.darota_quota_status() from public, anon;
grant execute on function public.darota_quota_status() to authenticated;

create or replace function public.darota_count_new_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  account public.darota_plan_accounts%rowtype;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  used_count integer;
begin
  -- Existing IDs are edits/retries, never new quota entries.
  if exists (select 1 from public.entregas where id = new.id) then return new; end if;
  insert into public.darota_plan_accounts(user_id) values (new.user_id)
    on conflict (user_id) do nothing;
  -- Account row lock serializes requests from multiple devices.
  select * into account from public.darota_plan_accounts
    where user_id = new.user_id for update;
  if not account.enforced or coalesce(account.premium_until > now(), false) then return new; end if;
  if exists (select 1 from public.darota_delivery_usage where user_id = new.user_id and delivery_id = new.id) then return new; end if;
  select count(*)::integer into used_count from public.darota_delivery_usage
    where user_id = new.user_id and usage_day = today;
  if used_count >= 5 then raise exception 'DAROTA_QUOTA_EXCEEDED'; end if;
  insert into public.darota_delivery_usage(user_id, delivery_id, usage_day)
    values (new.user_id, new.id, today);
  return new;
end;
$$;
revoke all on function public.darota_count_new_delivery() from public, anon, authenticated;
drop trigger if exists darota_delivery_quota on public.entregas;
create trigger darota_delivery_quota before insert on public.entregas
  for each row execute function public.darota_count_new_delivery();

create or replace function public.darota_add_deliveries(p_deliveries jsonb)
returns setof public.entregas language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_deliveries is null or jsonb_typeof(p_deliveries) <> 'array' then
    raise exception 'INVALID_BATCH';
  end if;
  if jsonb_array_length(p_deliveries) > 1000 then
    raise exception 'INVALID_BATCH';
  end if;
  -- Server assigns owner; caller cannot supply another user's ID or route.
  if exists (
    select 1 from jsonb_array_elements(p_deliveries) item
    where nullif(item->>'id', '') is null or nullif(btrim(item->>'endereco'), '') is null
      or (nullif(item->>'rota_id', '') is not null and not exists (
        select 1 from public.rotas where id = (item->>'rota_id')::uuid and user_id = owner_id
      ))
      or exists (select 1 from public.entregas where id = (item->>'id')::uuid and user_id <> owner_id)
  ) then raise exception 'INVALID_DELIVERY'; end if;
  -- One statement/transaction: over-limit batch rolls back in full.
  insert into public.entregas(id, cliente, endereco, status, observacoes, created_at, latitude, longitude, user_id, rota_id)
  select r.id, r.cliente, r.endereco, r.status, r.observacoes,
    coalesce(r.created_at, now()), r.latitude, r.longitude, owner_id, r.rota_id
  from jsonb_populate_recordset(null::public.entregas, p_deliveries) r
  on conflict (id) do nothing;
  return query select e.* from public.entregas e
    where e.user_id = owner_id and e.id in (
      select (item->>'id')::uuid from jsonb_array_elements(p_deliveries) item
    );
end;
$$;
revoke all on function public.darota_add_deliveries(jsonb) from public, anon;
grant execute on function public.darota_add_deliveries(jsonb) to authenticated;
commit;
