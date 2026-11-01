-- Cuentas de la familia — esquema inicial
-- Modelo: un HOGAR con sus MIEMBROS. Cada mes tiene un PLAN con LÍNEAS (ingresos, fijos, sobres).
-- Sobre esas líneas se registran COBROS (ingresos), PAGOS (fijos) y GASTOS (sobres).
-- item_key mantiene la identidad de una línea entre meses (la "Luz" de octubre y la de noviembre).

create extension if not exists pgcrypto;

-- ───────────────────────── Hogares y miembros ─────────────────────────
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Nuestra casa' check (char_length(name) between 1 and 60),
  timezone    text not null default 'America/Argentina/Buenos_Aires',
  created_at  timestamptz not null default now()
);

create table public.household_members (
  household_id  uuid not null references public.households(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  initial       text not null check (char_length(initial) between 1 and 2),
  email         text,
  role          text not null default 'member' check (role in ('owner', 'member')),
  notify_email  boolean not null default true,
  joined_at     timestamptz not null default now(),
  primary key (household_id, user_id)
);
-- Por ahora cada persona pertenece a un solo hogar.
create unique index household_members_one_per_user on public.household_members(user_id);

create table public.household_invites (
  code          text primary key,
  household_id  uuid not null references public.households(id) on delete cascade,
  created_by    uuid not null references auth.users(id) on delete cascade,
  expires_at    timestamptz not null default now() + interval '7 days',
  used_by       uuid references auth.users(id),
  used_at       timestamptz
);

-- ───────────────────────── Plan mensual ─────────────────────────
create type public.line_kind as enum ('income', 'fixed', 'envelope');

create table public.month_plans (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  month         date not null check (extract(day from month) = 1),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, month)
);

create table public.plan_lines (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.month_plans(id) on delete cascade,
  household_id  uuid not null references public.households(id) on delete cascade,
  kind          public.line_kind not null,
  item_key      uuid not null default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 60),
  amount        numeric(14, 2) not null default 0 check (amount >= 0),
  day           smallint check (day between 1 and 31),
  owner_user    uuid references auth.users(id),          -- de quién es el ingreso
  sort          integer not null default 0,
  unique (plan_id, item_key)
);
create index plan_lines_plan on public.plan_lines(plan_id);

-- ───────────────────────── Movimientos ─────────────────────────
create table public.payments (          -- pagos de gastos fijos (puede haber pagos parciales)
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  line_id       uuid not null references public.plan_lines(id) on delete restrict,
  amount        numeric(14, 2) not null check (amount > 0),
  paid_by       uuid references auth.users(id),
  paid_on       date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  note          text check (char_length(note) <= 120),
  source        text not null default 'app' check (source in ('app', 'telegram', 'import')),
  created_at    timestamptz not null default now()
);
create index payments_line on public.payments(line_id);

create table public.income_receipts (   -- cobros de ingresos
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  line_id       uuid not null references public.plan_lines(id) on delete restrict,
  amount        numeric(14, 2) not null check (amount > 0),
  received_by   uuid references auth.users(id),
  received_on   date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  source        text not null default 'app' check (source in ('app', 'telegram', 'import')),
  created_at    timestamptz not null default now()
);
create index income_receipts_line on public.income_receipts(line_id);

create table public.expenses (          -- gastos variables, cargados en un sobre
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  line_id       uuid not null references public.plan_lines(id) on delete restrict,
  amount        numeric(14, 2) not null check (amount > 0),
  spent_by      uuid references auth.users(id),
  spent_on      date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  note          text check (char_length(note) <= 120),
  source        text not null default 'app' check (source in ('app', 'telegram', 'import')),
  created_at    timestamptz not null default now()
);
create index expenses_line on public.expenses(line_id);
create index expenses_household_created on public.expenses(household_id, created_at desc);

-- ───────────────────────── Telegram y avisos ─────────────────────────
create table public.telegram_links (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  household_id  uuid not null references public.households(id) on delete cascade,
  chat_id       bigint not null unique,
  linked_at     timestamptz not null default now()
);

create table public.telegram_link_codes (
  code          text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  household_id  uuid not null references public.households(id) on delete cascade,
  expires_at    timestamptz not null default now() + interval '30 minutes'
);

create table public.reminder_log (      -- evita mandar el mismo aviso dos veces
  line_id   uuid not null references public.plan_lines(id) on delete cascade,
  kind      text not null check (kind in ('pre', 'due', 'overdue')),
  sent_at   timestamptz not null default now(),
  primary key (line_id, kind)
);

-- ───────────────────────── Integridad ─────────────────────────
-- Un movimiento debe pertenecer al mismo hogar que su línea, y a una línea del tipo correcto.
create or replace function public.check_movement_line() returns trigger
language plpgsql as $$
declare l record;
begin
  select household_id, kind into l from public.plan_lines where id = new.line_id;
  if l.household_id is distinct from new.household_id then
    raise exception 'La línea no pertenece a este hogar';
  end if;
  if (tg_table_name = 'payments' and l.kind <> 'fixed')
     or (tg_table_name = 'income_receipts' and l.kind <> 'income')
     or (tg_table_name = 'expenses' and l.kind <> 'envelope') then
    raise exception 'Tipo de línea incorrecto para %', tg_table_name;
  end if;
  return new;
end $$;
create trigger payments_line_check before insert or update on public.payments for each row execute function public.check_movement_line();
create trigger receipts_line_check before insert or update on public.income_receipts for each row execute function public.check_movement_line();
create trigger expenses_line_check before insert or update on public.expenses for each row execute function public.check_movement_line();

create or replace function public.check_plan_line_household() returns trigger
language plpgsql as $$
begin
  if (select household_id from public.month_plans where id = new.plan_id) is distinct from new.household_id then
    raise exception 'El plan no pertenece a este hogar';
  end if;
  return new;
end $$;
create trigger plan_lines_household_check before insert or update on public.plan_lines for each row execute function public.check_plan_line_household();

-- ───────────────────────── Permisos (RLS) ─────────────────────────
create or replace function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members where household_id = h and user_id = auth.uid())
$$;

create or replace function public.my_household() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.household_members where user_id = auth.uid() limit 1
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.month_plans enable row level security;
alter table public.plan_lines enable row level security;
alter table public.payments enable row level security;
alter table public.income_receipts enable row level security;
alter table public.expenses enable row level security;
alter table public.telegram_links enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.reminder_log enable row level security;

create policy "ver mi hogar" on public.households for select using (public.is_member(id));
create policy "editar mi hogar" on public.households for update using (public.is_member(id));

create policy "ver miembros" on public.household_members for select using (public.is_member(household_id));
create policy "editar mi ficha" on public.household_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "ver invitaciones" on public.household_invites for select using (public.is_member(household_id));

-- Tablas del hogar: cualquier miembro lee y escribe.
do $$
declare t text;
begin
  foreach t in array array['month_plans', 'plan_lines', 'payments', 'income_receipts', 'expenses'] loop
    execute format('create policy "miembros leen" on public.%I for select using (public.is_member(household_id))', t);
    execute format('create policy "miembros crean" on public.%I for insert with check (public.is_member(household_id))', t);
    execute format('create policy "miembros editan" on public.%I for update using (public.is_member(household_id)) with check (public.is_member(household_id))', t);
    execute format('create policy "miembros borran" on public.%I for delete using (public.is_member(household_id))', t);
  end loop;
end $$;

create policy "ver mi telegram" on public.telegram_links for select using (user_id = auth.uid());
create policy "desvincular mi telegram" on public.telegram_links for delete using (user_id = auth.uid());
-- telegram_link_codes y reminder_log: solo service role (sin políticas).

-- ───────────────────────── Vista de líneas con totales ─────────────────────────
create or replace view public.month_lines with (security_invoker = true) as
select l.*, p.month,
  coalesce((select sum(x.amount) from public.payments x where x.line_id = l.id), 0)        as paid,
  coalesce((select sum(x.amount) from public.income_receipts x where x.line_id = l.id), 0) as received,
  coalesce((select sum(x.amount) from public.expenses x where x.line_id = l.id), 0)        as spent
from public.plan_lines l
join public.month_plans p on p.id = l.plan_id;

-- ───────────────────────── Funciones (RPC) ─────────────────────────
-- Crear el hogar (la primera persona que entra).
create or replace function public.create_household(p_name text, p_display_name text, p_initial text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Necesitás iniciar sesión'; end if;
  if exists (select 1 from household_members where user_id = auth.uid()) then
    raise exception 'Ya pertenecés a un hogar';
  end if;
  insert into households(name) values (coalesce(nullif(trim(p_name), ''), 'Nuestra casa')) returning id into h;
  insert into household_members(household_id, user_id, display_name, initial, email, role)
  values (h, auth.uid(), trim(p_display_name), upper(left(trim(p_initial), 2)), (select email from auth.users where id = auth.uid()), 'owner');
  return h;
end $$;

-- Generar un código para sumar a la otra persona.
create or replace function public.create_invite() returns text
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_household(); c text;
begin
  if h is null then raise exception 'No pertenecés a ningún hogar'; end if;
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into household_invites(code, household_id, created_by) values (c, h, auth.uid());
  return c;
end $$;

-- Sumarse con un código.
create or replace function public.join_household(p_code text, p_display_name text, p_initial text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv household_invites;
begin
  if auth.uid() is null then raise exception 'Necesitás iniciar sesión'; end if;
  if exists (select 1 from household_members where user_id = auth.uid()) then
    raise exception 'Ya pertenecés a un hogar';
  end if;
  select * into inv from household_invites where code = upper(trim(p_code)) for update;
  if inv.code is null or inv.used_at is not null or inv.expires_at < now() then
    raise exception 'El código no es válido o ya venció';
  end if;
  insert into household_members(household_id, user_id, display_name, initial, email, role)
  values (inv.household_id, auth.uid(), trim(p_display_name), upper(left(trim(p_initial), 2)), (select email from auth.users where id = auth.uid()), 'member');
  update household_invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  return inv.household_id;
end $$;

-- Guardar el plan de un mes de una vez (atómico).
-- p_lines: [{item_key?, kind, name, amount, day?, owner_user?, sort}]
-- Las líneas que ya no vienen se borran, salvo que tengan movimientos (en ese caso se avisa).
create or replace function public.save_month_plan(p_month date, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare h uuid := public.my_household(); pid uuid; keys uuid[];
begin
  if h is null then raise exception 'No pertenecés a ningún hogar'; end if;
  if extract(day from p_month) <> 1 then raise exception 'El mes debe empezar el día 1'; end if;

  insert into month_plans(household_id, month, created_by, updated_by)
  values (h, p_month, auth.uid(), auth.uid())
  on conflict (household_id, month) do update set updated_by = auth.uid(), updated_at = now()
  returning id into pid;

  select coalesce(array_agg((e->>'item_key')::uuid), '{}') into keys
  from jsonb_array_elements(p_lines) e where e ? 'item_key' and e->>'item_key' <> '';

  if exists (
    select 1 from plan_lines l where l.plan_id = pid and not (l.item_key = any(keys))
      and (exists (select 1 from payments where line_id = l.id)
        or exists (select 1 from income_receipts where line_id = l.id)
        or exists (select 1 from expenses where line_id = l.id))
  ) then
    raise exception 'No se puede quitar una línea que ya tiene pagos, cobros o gastos cargados';
  end if;

  delete from plan_lines l where l.plan_id = pid and not (l.item_key = any(keys));

  insert into plan_lines(plan_id, household_id, kind, item_key, name, amount, day, owner_user, sort)
  select pid, h, (e->>'kind')::line_kind,
         coalesce(nullif(e->>'item_key', '')::uuid, gen_random_uuid()),
         trim(e->>'name'), coalesce((e->>'amount')::numeric, 0),
         nullif(e->>'day', '')::smallint, nullif(e->>'owner_user', '')::uuid,
         coalesce((e->>'sort')::int, 0)
  from jsonb_array_elements(p_lines) e
  on conflict (plan_id, item_key) do update
    set name = excluded.name, amount = excluded.amount, day = excluded.day,
        owner_user = excluded.owner_user, sort = excluded.sort, kind = excluded.kind;

  return pid;
end $$;

-- Código para vincular Telegram desde la app.
create or replace function public.create_telegram_code() returns text
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_household(); c text;
begin
  if h is null then raise exception 'No pertenecés a ningún hogar'; end if;
  delete from telegram_link_codes where user_id = auth.uid();
  c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into telegram_link_codes(code, user_id, household_id) values (c, auth.uid(), h);
  return c;
end $$;

grant execute on function public.create_household, public.create_invite, public.join_household,
  public.save_month_plan, public.create_telegram_code, public.is_member, public.my_household to authenticated;

-- ───────────────────────── Tiempo real ─────────────────────────
alter publication supabase_realtime add table public.month_plans, public.plan_lines,
  public.payments, public.income_receipts, public.expenses;
