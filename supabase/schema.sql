-- =====================================================================================
-- EG Laundry: Supabase / PostgreSQL schema (v0.1)
-- Run this whole file in Supabase Dashboard -> SQL Editor. It is the complete schema: it works on an
-- empty project and can be run again (every statement is idempotent).
-- Then the operator sets the owner's one-time setup code (not callable from the app):
--   select public.set_setup_code('ABCD-EFGH');
-- Design notes:
--  * One laundry = one organisation. Signing up gives no access by itself: the owner enters the setup
--    code (once, only while no organisation exists) and everyone else enters a one-time invitation
--    code made by an owner/admin (join_with_code). Codes are stored only as SHA-256 hashes.
--  * Every business row carries org_id; Row Level Security is is_org_member(org_id) (admin-only for
--    prices and corrections), and composite foreign keys (org_id, id) make cross-organisation
--    references impossible.
--  * Every change is recorded in audit_log by triggers; nobody can change that history via the API.
--  * Core (membership, history, storage, keep-alive, backups) first, then the laundry tables of SPEC
--    section 3 (price list, customers, orders, packages, payments) with their consistency triggers.
-- =====================================================================================

begin;

-- ---------- helpers ----------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- organisations & membership ----------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  role text not null check (role in ('owner', 'admin', 'staff')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists organization_members_user_idx on public.organization_members (user_id);

-- One row per invitation code. The code itself lives (hashed) in invitation_codes.
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- who it is for, free text ("Istri", "Mbak Sari")
  label text,
  -- unused (no email invitations); kept so backups share one format with the kos app
  email text,
  -- 'owner' can never be granted through an invitation
  role text not null check (role in ('admin', 'staff')),
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists invitations_org_idx on public.invitations (org_id, expires_at) where accepted_at is null;

-- Code hashes are kept apart from invitations: no grants, no policies, so they never reach a client
-- (nor a backup made through the API).
create table if not exists public.invitation_codes (
  invitation_id uuid primary key references public.invitations(id) on delete cascade,
  code_hash text not null unique
);

-- Singleton with the owner's setup code (set by the operator with set_setup_code).
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  setup_code_hash text,
  setup_code_used_at timestamptz
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- Failed join_with_code attempts, for rate limiting.
create table if not exists public.join_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists join_attempts_user_idx on public.join_attempts (user_id, attempted_at);

-- security definer so RLS policies on organization_members itself do not recurse
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_org_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Same normalisation as the client (normalizeCode): upper case, letters and digits only.
create or replace function public.normalize_code(p_code text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
$$;

create or replace function public.hash_code(p_code text)
returns text language sql stable set search_path = public, pg_temp as $$
  select encode(sha256(convert_to(public.normalize_code(p_code), 'UTF8')), 'hex');
$$;

-- Operator only (SQL editor / service role): store the owner's setup code and make it usable again.
create or replace function public.set_setup_code(p_code text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if char_length(public.normalize_code(p_code)) < 8 then
    raise exception 'Kode pemilik minimal 8 huruf/angka.';
  end if;
  insert into public.app_settings (id, setup_code_hash, setup_code_used_at)
  values (1, public.hash_code(p_code), null)
  on conflict (id) do update set setup_code_hash = excluded.setup_code_hash, setup_code_used_at = null;
  if exists (select 1 from public.organizations) then
    return 'Kode disimpan, tetapi organisasi sudah ada: kode pemilik hanya berlaku selama belum ada organisasi.';
  end if;
  return 'Kode pemilik disimpan. Berlaku sekali, untuk akun pertama yang memasukkannya.';
end $$;

-- Called by the app after login: the existing membership (owner first, then oldest). Never creates
-- anything; SQLSTATE WB001 tells the app to show the "enter a code" screen.
create or replace function public.ensure_membership()
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  org uuid;
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Belum masuk.'; end if;
  select org_id into org from public.organization_members
   where user_id = me order by (role = 'owner') desc, created_at asc limit 1;
  if org is null then
    raise exception using errcode = 'WB001', message = 'Akun ini belum menjadi anggota. Masukkan kode dari pemilik laundry.';
  end if;
  return org;
end $$;

-- Join with an invitation code, or (while no organisation exists) the owner setup code.
-- Returns the organisation id, or null for a wrong/expired/used code.
create or replace function public.join_with_code(p_code text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  h text;
  inv record;
  new_org uuid;
  added int;
begin
  if me is null then raise exception 'Belum masuk.'; end if;
  -- one attempt per account at a time, so parallel requests cannot get past the limit
  perform pg_advisory_xact_lock(hashtextextended('join_with_code:' || me::text, 0));
  delete from public.join_attempts where user_id = me and attempted_at < now() - interval '1 day';
  if (select count(*) from public.join_attempts
      where user_id = me and attempted_at > now() - interval '1 hour') >= 10 then
    raise exception 'Terlalu banyak percobaan. Coba lagi dalam 1 jam.';
  end if;

  if char_length(public.normalize_code(p_code)) >= 8 then
    h := public.hash_code(p_code);

    -- the row lock makes a code usable once, even when two people enter it at the same moment
    select i.id, i.org_id, i.role, i.invited_by into inv
      from public.invitation_codes c
      join public.invitations i on i.id = c.invitation_id
     where c.code_hash = h and i.accepted_at is null and i.expires_at > now()
       for update of i;
    -- a code only works while whoever made it may still invite (checked after the lock, so a
    -- removal or demotion committed meanwhile counts)
    if found and exists (select 1 from public.organization_members m
                          where m.org_id = inv.org_id and m.user_id = inv.invited_by and m.role in ('owner', 'admin')) then
      insert into public.organization_members (org_id, user_id, email, role)
      values (inv.org_id, me, (select u.email from auth.users u where u.id = me), inv.role)
      on conflict (org_id, user_id) do nothing;
      get diagnostics added = row_count;
      -- already a member: leave the code for the person it was made for
      if added > 0 then
        update public.invitations set accepted_at = now(), accepted_by = me where id = inv.id;
      end if;
      return inv.org_id;
    end if;

    -- owner setup code; the lock serialises two people entering it at the same moment
    perform 1 from public.app_settings s
     where s.id = 1 and s.setup_code_hash = h and s.setup_code_used_at is null
       for update;
    if found and not exists (select 1 from public.organizations) then
      insert into public.organizations (name, created_by) values ('EG Laundry', me) returning id into new_org;
      insert into public.organization_members (org_id, user_id, email, role)
      values (new_org, me, (select u.email from auth.users u where u.id = me), 'owner');
      update public.app_settings set setup_code_used_at = now() where id = 1;
      return new_org;
    end if;
  end if;

  -- an exception would roll this record back, so a failure returns null instead
  insert into public.join_attempts (user_id) values (me);
  return null;
end $$;

-- Admin only: a one-time code (8 characters, valid 7 days) for a new admin/staff member. It works
-- only while its maker is still an owner/admin. The plain code is returned once; only its hash is stored.
create or replace function public.create_invitation(p_org_id uuid, p_role text, p_label text)
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  clean_label text := nullif(btrim(p_label, E' \t\r\n'), '');
  new_code text;
  inv_id uuid;
  inv_expires timestamptz;
  rnd bytea;
  b int;
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'Hanya pemilik/admin yang dapat membuat kode undangan.';
  end if;
  if p_role is null or p_role not in ('admin', 'staff') then
    raise exception 'Peran tidak valid.';
  end if;
  if char_length(clean_label) > 60 then
    raise exception 'Keterangan maksimal 60 karakter.';
  end if;
  -- serialise per organisation so the limit holds under concurrent calls
  perform 1 from public.organizations o where o.id = p_org_id for no key update;
  if (select count(*) from public.invitations i
      where i.org_id = p_org_id and i.accepted_at is null and i.expires_at > now()) >= 20 then
    raise exception 'Sudah ada 20 kode undangan aktif. Hapus kode yang tidak dipakai dulu.';
  end if;

  insert into public.invitations as i (org_id, label, role, invited_by)
  values (p_org_id, clean_label, p_role, auth.uid())
  returning i.id, i.expires_at into inv_id, inv_expires;

  loop
    new_code := '';
    while char_length(new_code) < 8 loop
      rnd := uuid_send(gen_random_uuid());
      for k in 0..15 loop
        b := get_byte(rnd, k);
        -- bytes 6 and 8 hold the UUID version/variant bits; values >= 248 would bias the modulo
        continue when k in (6, 8) or b >= 248;
        new_code := new_code || substr(alphabet, 1 + b % 31, 1);
        exit when char_length(new_code) = 8;
      end loop;
    end loop;
    begin
      insert into public.invitation_codes (invitation_id, code_hash) values (inv_id, public.hash_code(new_code));
      exit;
    exception when unique_violation then
      null; -- that code is already in use: draw another
    end;
  end loop;

  return query select new_code, inv_expires;
end $$;

-- Owner only. The organisation always keeps at least one owner.
create or replace function public.set_member_role(p_org_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target_role text;
begin
  -- serialise membership changes per organisation (two owners demoting each other at once)
  perform 1 from public.organizations where id = p_org_id for no key update;
  if not public.is_org_owner(p_org_id) then
    raise exception 'Hanya pemilik yang dapat mengubah peran anggota.';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'staff') then
    raise exception 'Peran tidak valid.';
  end if;
  select role into target_role from public.organization_members where org_id = p_org_id and user_id = p_user_id;
  if target_role is null then
    raise exception 'Anggota tidak ditemukan.';
  end if;
  if target_role = 'owner' and p_role <> 'owner'
     and (select count(*) from public.organization_members where org_id = p_org_id and role = 'owner') <= 1 then
    raise exception 'Tidak dapat mengubah peran pemilik terakhir.';
  end if;
  update public.organization_members set role = p_role
   where org_id = p_org_id and user_id = p_user_id and role <> p_role;
  -- staff cannot invite: codes they made earlier stop working
  if p_role = 'staff' then
    update public.invitations set expires_at = now()
     where org_id = p_org_id and invited_by = p_user_id and accepted_at is null and expires_at > now();
  end if;
end $$;

create or replace function public.remove_member(p_org_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owners int;
  target_role text;
begin
  perform 1 from public.organizations where id = p_org_id for no key update;
  if not public.is_org_admin(p_org_id) then
    raise exception 'Hanya pemilik/admin yang dapat menghapus anggota.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Tidak dapat menghapus diri sendiri.';
  end if;
  select role into target_role from public.organization_members where org_id = p_org_id and user_id = p_user_id;
  if target_role is null then return; end if;
  if target_role = 'owner' then
    if not public.is_org_owner(p_org_id) then
      raise exception 'Hanya pemilik yang dapat menghapus pemilik lain.';
    end if;
    select count(*) into owners from public.organization_members where org_id = p_org_id and role = 'owner';
    if owners <= 1 then
      raise exception 'Tidak dapat menghapus pemilik terakhir.';
    end if;
  elsif target_role = 'admin' and not public.is_org_owner(p_org_id) then
    raise exception 'Hanya pemilik yang dapat menghapus admin.';
  end if;
  -- codes the person made stop working too
  update public.invitations set expires_at = now()
   where org_id = p_org_id and invited_by = p_user_id and accepted_at is null and expires_at > now();
  delete from public.organization_members where org_id = p_org_id and user_id = p_user_id;
end $$;

-- ---------- laundry tables (SPEC section 3) ----------
-- Every table has org_id and unique (org_id, id) so children reference parents with a composite FK: a row can
-- never point into another organisation. Order items and sold packages carry COPIES of the service / catalog
-- entry, so later price changes leave history alone. Totals and the pay status are never stored (SPEC 3.3):
-- the app derives them from items and payments, and the triggers below keep those rows consistent.

-- WhatsApp texts of the laundry (SPEC 3.7, 3.9); a no-op on an installation that already has them
alter table public.organizations add column if not exists promo_template text;
alter table public.organizations add column if not exists wa_footer text;

-- price list (SPEC 3.1): admin only; staff read it
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  unit text not null check (unit in ('kg', 'pcs')),
  price bigint not null check (price >= 0),
  -- null = this service has no express option
  price_express bigint check (price_express is null or price_express >= 0),
  days_regular int not null default 3 check (days_regular >= 0),
  days_express int check (days_express is null or days_express >= 0),
  -- minimum billed quantity (2 kg); 0 = none
  min_qty numeric(8,2) not null default 0 check (min_qty >= 0),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);

-- customers (SPEC 3.2): kos tenants (is_tenant, room_name, kos_tenant_id from the Woombad import) and walk-ins
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text,
  is_tenant boolean not null default false,
  room_name text,
  kos_tenant_id text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);

-- orders (SPEC 3.3)
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- 'LD-YYYYMM-NNNN'; a clash (two phones at once) makes the app retry with the next number
  order_number text not null,
  customer_id uuid not null,
  received_at date not null default current_date,
  promised_at date,
  express boolean not null default false,
  status text not null default 'received' check (status in ('received', 'processing', 'ready', 'done', 'cancelled')),
  ready_at timestamptz,
  picked_up_at timestamptz,
  discount bigint not null default 0 check (discount >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, order_number),
  -- a customer with orders stays (the app says "masih dipakai")
  foreign key (org_id, customer_id) references public.customers (org_id, id) on delete restrict
);

-- packages on offer (SPEC 3.4): admin only
create table if not exists public.package_catalog (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  service_id uuid not null,
  qty numeric(8,2) not null check (qty > 0),
  price bigint not null check (price >= 0),
  -- null = never expires
  valid_days int check (valid_days is null or valid_days > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, service_id) references public.services (org_id, id) on delete restrict
);

-- packages a customer bought (SPEC 3.4): a copy of the catalog entry; the remaining qty is computed from items
create table if not exists public.customer_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  catalog_id uuid,
  name text not null,
  service_id uuid not null,
  qty_total numeric(8,2) not null check (qty_total > 0),
  price bigint not null check (price >= 0),
  purchased_at date not null default current_date,
  expires_at date,
  method text not null default 'cash' check (method in ('cash', 'transfer', 'qris')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, customer_id) references public.customers (org_id, id) on delete restrict,
  foreign key (org_id, catalog_id) references public.package_catalog (org_id, id) on delete set null (catalog_id),
  foreign key (org_id, service_id) references public.services (org_id, id) on delete restrict
);

-- order lines (SPEC 3.3): the service copied at the time of the order
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null,
  service_id uuid,
  service_name text not null,
  unit text not null check (unit in ('kg', 'pcs')),
  unit_price bigint not null check (unit_price >= 0),
  qty numeric(8,2) not null check (qty > 0),
  line_total bigint not null,
  customer_package_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- the line always explains itself; pcs are whole; a package line is free
  check (line_total = round(qty * unit_price)),
  check (unit <> 'pcs' or qty = trunc(qty)),
  check (customer_package_id is null or unit_price = 0),
  unique (org_id, id),
  foreign key (org_id, order_id) references public.orders (org_id, id) on delete cascade,
  foreign key (org_id, service_id) references public.services (org_id, id) on delete set null (service_id),
  foreign key (org_id, customer_package_id) references public.customer_packages (org_id, id) on delete restrict
);

-- payments (SPEC 3.5): DP and settlement; never more than the order total (payments_limit below)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null,
  amount bigint not null check (amount > 0),
  paid_at date not null default current_date,
  method text not null default 'cash' check (method in ('cash', 'transfer', 'qris')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, order_id) references public.orders (org_id, id) on delete cascade
);

-- indexes
create index if not exists services_org_idx on public.services (org_id, sort_order);
create index if not exists customers_org_idx on public.customers (org_id, name);
create index if not exists orders_org_received_idx on public.orders (org_id, received_at desc);
create index if not exists orders_org_status_idx on public.orders (org_id, status);
create index if not exists orders_customer_idx on public.orders (customer_id);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_package_idx on public.order_items (customer_package_id) where customer_package_id is not null;
create index if not exists package_catalog_org_idx on public.package_catalog (org_id);
create index if not exists customer_packages_customer_idx on public.customer_packages (customer_id);
create index if not exists customer_packages_org_idx on public.customer_packages (org_id, purchased_at);
create index if not exists payments_org_paid_idx on public.payments (org_id, paid_at);
create index if not exists payments_order_idx on public.payments (order_id);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['services', 'customers', 'orders', 'order_items', 'package_catalog', 'customer_packages', 'payments'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------- row ownership helpers ----------

create or replace function public.set_created_by()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    else
      new.created_by := old.created_by;
    end if;
  end if;
  return new;
end $$;

-- A row never moves to another organisation (someone in two organisations could otherwise carry
-- customers' data across).
create or replace function public.keep_org_id()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and new.org_id is distinct from old.org_id then
    raise exception 'Data tidak dapat dipindah ke organisasi lain.';
  end if;
  return new;
end $$;

drop trigger if exists set_created_by on public.organizations;
create trigger set_created_by before insert or update of created_by on public.organizations
  for each row execute function public.set_created_by();
drop trigger if exists set_created_by on public.payments;
create trigger set_created_by before insert or update of created_by on public.payments
  for each row execute function public.set_created_by();

do $$
declare t text;
begin
  foreach t in array array['services', 'customers', 'orders', 'order_items', 'package_catalog', 'customer_packages', 'payments'] loop
    execute format('drop trigger if exists keep_org_id on public.%I', t);
    execute format('create trigger keep_org_id before update of org_id on public.%I for each row execute function public.keep_org_id()', t);
  end loop;
end $$;

-- ---------- laundry rules (SPEC 3.3 - 3.5, 3.10) ----------
-- Row-level rights are in the policies below; these triggers keep the rows consistent and guard what a
-- policy cannot express. auth.uid() is null for the operator (SQL editor, service role): the role rule
-- (orders_done_guard) does not limit the operator, the integrity rules apply to everyone. The functions
-- are security definer so their sums see every row whatever the caller's policies hide.

-- A done/cancelled order is frozen for staff: neither the order nor its items change (SPEC 3.3, 3.10).
create or replace function public.orders_done_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ids uuid[];
  oid uuid;
  o record;
begin
  if auth.uid() is not null then
    if tg_table_name = 'orders' then
      if old.status in ('done', 'cancelled') and not public.is_org_admin(old.org_id) then
        raise exception 'Pesanan yang sudah selesai hanya bisa diubah pemilik/admin.';
      end if;
    else
      ids := case tg_op when 'INSERT' then array[new.order_id] when 'DELETE' then array[old.order_id]
                        else array[new.order_id, old.order_id] end;
      foreach oid in array ids loop
        select status, org_id into o from public.orders where id = oid;
        if found and o.status in ('done', 'cancelled') and not public.is_org_admin(o.org_id) then
          raise exception 'Pesanan yang sudah selesai hanya bisa diubah pemilik/admin.';
        end if;
      end loop;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists orders_done_guard on public.orders;
create trigger orders_done_guard before update on public.orders
  for each row execute function public.orders_done_guard();
drop trigger if exists orders_done_guard on public.order_items;
create trigger orders_done_guard before insert or update or delete on public.order_items
  for each row execute function public.orders_done_guard();

-- Cancelling: only from Diterima/Proses, and only while nothing was paid (delete the payments first, admin).
create or replace function public.orders_cancel_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    if old.status not in ('received', 'processing') then
      raise exception 'Pesanan hanya dapat dibatalkan selama Diterima/Proses.';
    end if;
    if exists (select 1 from public.payments where order_id = new.id) then
      raise exception 'Pesanan yang sudah ada pembayarannya tidak dapat dibatalkan.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists orders_cancel_guard on public.orders;
create trigger orders_cancel_guard before update of status on public.orders
  for each row execute function public.orders_cancel_guard();

-- The payments of an order never exceed its total (items minus discount), whichever side changes: a payment,
-- the discount, or an item. (When items of a paid order are replaced, add the new ones before removing the old.)
create or replace function public.payments_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ids uuid[];
  oid uuid;
  total bigint;
  paid bigint;
begin
  if tg_table_name = 'orders' then
    ids := array[new.id];
  else
    ids := case tg_op when 'INSERT' then array[new.order_id] when 'DELETE' then array[old.order_id]
                      else array[new.order_id, old.order_id] end;
  end if;
  foreach oid in array ids loop
    select greatest(coalesce((select sum(i.line_total) from public.order_items i where i.order_id = o.id), 0) - o.discount, 0)
      into total from public.orders o where o.id = oid;
    if total is null then continue; end if;
    select coalesce(sum(amount), 0) into paid from public.payments where order_id = oid;
    if paid > total then
      raise exception 'Pembayaran melebihi total pesanan.';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists payments_limit on public.payments;
create trigger payments_limit after insert or update on public.payments
  for each row execute function public.payments_limit();
drop trigger if exists payments_limit on public.order_items;
create trigger payments_limit after insert or update or delete on public.order_items
  for each row execute function public.payments_limit();
drop trigger if exists payments_limit on public.orders;
create trigger payments_limit after update of discount on public.orders
  for each row execute function public.payments_limit();

-- An item that draws on a prepaid package (SPEC 3.4): the order's customer owns it, it is for the same
-- service, it has not expired on the received date, and its remaining qty (items on orders that are not
-- cancelled) covers the item.
create or replace function public.package_use_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  o record;
  used numeric;
begin
  if new.customer_package_id is null then return new; end if;
  select customer_id, service_id, expires_at, qty_total into p from public.customer_packages where id = new.customer_package_id;
  if not found then return new; end if;  -- the foreign key reports it
  select customer_id, received_at into o from public.orders where id = new.order_id;
  if not found then return new; end if;
  if p.customer_id <> o.customer_id then
    raise exception 'Paket ini milik pelanggan lain.';
  end if;
  if new.service_id is distinct from p.service_id then
    raise exception 'Paket ini tidak berlaku untuk layanan tersebut.';
  end if;
  if p.expires_at is not null and p.expires_at < o.received_at then
    raise exception 'Paket sudah kedaluwarsa pada tanggal masuk pesanan.';
  end if;
  select coalesce(sum(i.qty), 0) into used
    from public.order_items i join public.orders x on x.id = i.order_id
   where i.customer_package_id = new.customer_package_id and i.id <> new.id and x.status <> 'cancelled';
  if used + new.qty > p.qty_total then
    raise exception 'Sisa paket tidak cukup.';
  end if;
  return new;
end $$;

drop trigger if exists package_use_guard on public.order_items;
create trigger package_use_guard before insert or update on public.order_items
  for each row execute function public.package_use_guard();

-- The same rules when the order itself changes: another customer, a later received date, or back from cancelled.
create or replace function public.orders_package_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  used numeric;
begin
  if new.customer_id is distinct from old.customer_id and exists (
       select 1 from public.order_items i join public.customer_packages p on p.id = i.customer_package_id
        where i.order_id = new.id and p.customer_id <> new.customer_id) then
    raise exception 'Paket ini milik pelanggan lain.';
  end if;
  if (old.status = 'cancelled' and new.status <> 'cancelled') or new.received_at is distinct from old.received_at then
    for r in select p.id, p.qty_total, p.expires_at, sum(i.qty) as qty
               from public.order_items i join public.customer_packages p on p.id = i.customer_package_id
              where i.order_id = new.id group by p.id, p.qty_total, p.expires_at loop
      if r.expires_at is not null and r.expires_at < new.received_at then
        raise exception 'Paket sudah kedaluwarsa pada tanggal masuk pesanan.';
      end if;
      if new.status <> 'cancelled' then
        select coalesce(sum(i.qty), 0) into used
          from public.order_items i join public.orders x on x.id = i.order_id
         where i.customer_package_id = r.id and x.id <> new.id and x.status <> 'cancelled';
        if used + r.qty > r.qty_total then
          raise exception 'Sisa paket tidak cukup.';
        end if;
      end if;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists orders_package_guard on public.orders;
create trigger orders_package_guard before update of customer_id, status, received_at on public.orders
  for each row execute function public.orders_package_guard();

-- A sold package is money already counted (SPEC 3.4, 3.5: its price is uang masuk on purchased_at): staff record
-- the sale and may fix its note, every other change (price, method, dates, qty, customer, service, ...) is a
-- correction for the owner/admin, like changing a payment (SPEC 2.2, 3.10). The app itself never edits a sale.
create or replace function public.customer_packages_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_org_admin(old.org_id)
     and (to_jsonb(new) - 'notes' - 'updated_at') is distinct from (to_jsonb(old) - 'notes' - 'updated_at') then
    raise exception 'Paket yang sudah terjual hanya bisa diubah pemilik/admin.';
  end if;
  return new;
end $$;

drop trigger if exists customer_packages_guard on public.customer_packages;
create trigger customer_packages_guard before update on public.customer_packages
  for each row execute function public.customer_packages_guard();

-- ---------- audit log ----------
-- Append-only history written by triggers. Owners/admins can read it; nobody can change it via the API.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  table_name text not null,
  row_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);
create index if not exists audit_log_org_changed_idx on public.audit_log (org_id, changed_at desc);

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  any_row jsonb := coalesce(new_row, old_row);
  org uuid := (case when tg_table_name = 'organizations' then any_row ->> 'id' else any_row ->> 'org_id' end)::uuid;
begin
  if tg_op = 'UPDATE' and old_row = new_row then return null; end if;
  -- rows removed while an organisation is being deleted (operator only): its history goes with it
  if not exists (select 1 from public.organizations where id = org) then return null; end if;
  -- clock_timestamp keeps several changes made in one request in order
  insert into public.audit_log (org_id, table_name, row_id, action, changed_by, changed_at, old_data, new_data)
  values (org, tg_table_name, (any_row ->> 'id')::uuid, lower(tg_op), auth.uid(), clock_timestamp(), old_row, new_row);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['organizations', 'organization_members', 'invitations',
                           'services', 'customers', 'orders', 'order_items', 'package_catalog', 'customer_packages', 'payments'] loop
    execute format('drop trigger if exists audit_row_change on public.%I', t);
    execute format('create trigger audit_row_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- ---------- Row Level Security ----------

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.invitations enable row level security;
alter table public.invitation_codes enable row level security;
alter table public.app_settings enable row level security;
alter table public.join_attempts enable row level security;
alter table public.audit_log enable row level security;
alter table public.services enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.package_catalog enable row level security;
alter table public.customer_packages enable row level security;
alter table public.payments enable row level security;
-- invitation_codes, app_settings, join_attempts: no policies (and no grants) on purpose

-- organizations: created only by join_with_code() (security definer)
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations for select using (public.is_org_member(id));
drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations for update using (public.is_org_admin(id)) with check (public.is_org_admin(id));

-- organization_members: read-only; changes go through join_with_code / set_member_role / remove_member
drop policy if exists members_select on public.organization_members;
create policy members_select on public.organization_members for select using (public.is_org_member(org_id));

-- invitations: admins see and delete them; they are created by create_invitation()
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations for select using (public.is_org_admin(org_id));
drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations for delete using (public.is_org_admin(org_id));

-- audit_log: owners/admins read; no insert/update/delete policy for anyone
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select using (public.is_org_admin(org_id));

-- laundry tables (SPEC 3.10): every member reads; the price list and the package catalog are admin-only
-- writes; orders, items, customers, sold packages and payments are recorded by every member; corrections
-- (payments, deletes, closed orders through orders_done_guard) are admin-only
do $$
declare
  t text;
  op text;
begin
  foreach t in array array['services', 'customers', 'orders', 'order_items', 'package_catalog', 'customer_packages', 'payments'] loop
    foreach op in array array['select', 'insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', t || '_' || op, t);
    end loop;
    execute format('create policy %I on public.%I for select using (public.is_org_member(org_id))', t || '_select', t);
  end loop;
  foreach t in array array['services', 'package_catalog'] loop
    execute format('create policy %I on public.%I for insert with check (public.is_org_admin(org_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (public.is_org_admin(org_id))', t || '_delete', t);
  end loop;
  foreach t in array array['customers', 'orders', 'order_items', 'customer_packages', 'payments'] loop
    execute format('create policy %I on public.%I for insert with check (public.is_org_member(org_id))', t || '_insert', t);
  end loop;
  foreach t in array array['customers', 'orders', 'order_items', 'customer_packages'] loop
    execute format('create policy %I on public.%I for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))', t || '_update', t);
  end loop;
  -- items may be removed by staff while the order is open (orders_done_guard); everything else only by admins
  execute 'create policy order_items_delete on public.order_items for delete using (public.is_org_member(org_id))';
  execute 'create policy payments_update on public.payments for update using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id))';
  foreach t in array array['customers', 'orders', 'customer_packages', 'payments'] loop
    execute format('create policy %I on public.%I for delete using (public.is_org_admin(org_id))', t || '_delete', t);
  end loop;
end $$;

-- ---------- Storage (laundry logo) ----------
-- Object paths are "<org_id>/<file>"; the logos bucket holds the laundry logo (small images only, 1 MB):
-- every member may read it, only an admin writes it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', false, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.path_org_id(p_name text)
returns uuid language plpgsql immutable set search_path = public, pg_temp as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end $$;

drop policy if exists storage_org_select on storage.objects;
create policy storage_org_select on storage.objects for select
  using (bucket_id = 'logos' and public.is_org_member(public.path_org_id(name)));
drop policy if exists storage_org_insert on storage.objects;
create policy storage_org_insert on storage.objects for insert
  with check (bucket_id = 'logos' and public.is_org_admin(public.path_org_id(name)));
drop policy if exists storage_org_update on storage.objects;
create policy storage_org_update on storage.objects for update
  using (bucket_id = 'logos' and public.is_org_admin(public.path_org_id(name)));
drop policy if exists storage_org_delete on storage.objects;
create policy storage_org_delete on storage.objects for delete
  using (bucket_id = 'logos' and public.is_org_admin(public.path_org_id(name)));

-- ---------- keep-alive ----------
-- Free Supabase projects are paused after about a week with too little database activity. A scheduled GitHub
-- Action (.github/workflows/keepalive.yml) calls keepalive() a few times a day. Read-only pings are reported not
-- to count, so it updates one heartbeat row (at most once a minute, so calling it in a loop changes nothing).
-- The row is not readable through the API and not part of the change history.
create table if not exists public.keepalive_heartbeat (
  id int primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now(),
  pings bigint not null default 0
);
alter table public.keepalive_heartbeat enable row level security;

create or replace function public.keepalive()
returns timestamptz language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  insert into public.keepalive_heartbeat as h (id, pinged_at, pings) values (1, now(), 1)
  on conflict (id) do update set pinged_at = now(), pings = h.pings + 1
  where h.pinged_at < now() - interval '1 minute';
  return now();
end $$;

-- ---------- scheduled backups ----------
-- A weekly GitHub Action (.github/workflows/backup.yml) signs in as eg_laundry_backup, a login role that can do
-- one thing: run export_backup(). It cannot read or change any table directly. Its password is set by the
-- operator only, never in this file:  alter role eg_laundry_backup password '...';
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'eg_laundry_backup') then
    create role eg_laundry_backup login noinherit connection limit 2;
  end if;
end $$;
alter role eg_laundry_backup set statement_timeout = '60s';

-- Every organisation as one backup file in the app's format ({ version, exportedAt, orgName, tables }, the same as
-- Pengaturan -> Data -> Unduh cadangan lengkap). Code hashes, the setup code and join attempts are left out.
create or replace function public.export_backup()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  o record;
  t text;
  tables jsonb;
  rows jsonb;
  result jsonb := '[]'::jsonb;
begin
  for o in select * from public.organizations order by created_at, id loop
    tables := jsonb_build_object('organizations', jsonb_build_array(to_jsonb(o)));
    foreach t in array array['organization_members', 'invitations',
                             'services', 'customers', 'orders', 'order_items', 'package_catalog', 'customer_packages', 'payments'] loop
      execute format('select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), ''[]'') from public.%I x where x.org_id = $1', t)
        into rows using o.id;
      tables := tables || jsonb_build_object(t, rows);
    end loop;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.changed_at, a.id), '[]') into rows from public.audit_log a where a.org_id = o.id;
    tables := tables || jsonb_build_object('audit_log', rows);
    result := result || jsonb_build_array(jsonb_build_object(
      'version', 1,
      'exportedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'orgName', o.name,
      'tables', tables));
  end loop;
  return result;
end $$;

-- ---------- grants: least privilege ----------
-- Supabase grants ALL (including TRUNCATE, which ignores RLS) on new tables and EXECUTE on new
-- functions to anon and authenticated. Take everything back, then grant exactly what the app uses:
-- anon gets only keepalive(); authenticated gets the table rights its policies need and the RPCs.
-- Trigger functions need no grant (EXECUTE is not checked when a trigger fires).

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, update on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant select, delete on public.invitations to authenticated;
grant select, insert, update, delete on public.services, public.customers, public.orders, public.order_items,
  public.package_catalog, public.customer_packages, public.payments to authenticated;
grant select on public.audit_log to authenticated;
-- RPCs
grant execute on function public.ensure_membership() to authenticated;
grant execute on function public.join_with_code(text) to authenticated;
grant execute on function public.create_invitation(uuid, text, text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
-- policy and trigger helpers are evaluated as the calling role and must stay executable
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;
grant execute on function public.path_org_id(text) to authenticated;
-- the scheduled keep-alive ping uses the public key, i.e. the anon role
grant execute on function public.keepalive() to anon;
-- the weekly backup job
grant usage on schema public to eg_laundry_backup;
grant execute on function public.export_backup() to eg_laundry_backup;
-- operator only
grant execute on function public.set_setup_code(text) to service_role;
-- objects added to public later get no access until granted explicitly
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

commit;
