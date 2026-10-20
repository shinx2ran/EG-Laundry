-- Laundry tables (SPEC 3): constraints, the consistency triggers, staff limits (3.10), isolation between
-- organisations, audit rows, cascade/restrict/set-null on delete. Continues from the members left by
-- 10-schema-tests: owner (owner), wife (admin), staff (staff), stranger (no member) of org1.
\set ON_ERROR_STOP on
select set_config('zz.suite', '20-laundry', false);

select zz.user('owner2', '88888888-0000-0000-0000-000000000001', 'owner2@example.com');
insert into zz.ids values
  ('org2', '88888888-0000-0000-0000-00000000000a'),
  ('svc_kering', 'b1000000-0000-0000-0000-000000000001'), ('svc_setrika', 'b1000000-0000-0000-0000-000000000002'),
  ('svc_bedcover', 'b1000000-0000-0000-0000-000000000003'), ('svc_setrika_saja', 'b1000000-0000-0000-0000-000000000004'),
  ('cust_rina', 'b1000000-0000-0000-0000-000000000011'), ('cust_hendra', 'b1000000-0000-0000-0000-000000000012'),
  ('cust_unused', 'b1000000-0000-0000-0000-000000000013'),
  ('ord1', 'b1000000-0000-0000-0000-000000000021'), ('ord_done', 'b1000000-0000-0000-0000-000000000022'),
  ('ord_pkg', 'b1000000-0000-0000-0000-000000000023'), ('ord_cancel', 'b1000000-0000-0000-0000-000000000024'),
  ('ord_hendra', 'b1000000-0000-0000-0000-000000000025'), ('ord_late', 'b1000000-0000-0000-0000-000000000026'),
  ('ord_pkg2', 'b1000000-0000-0000-0000-000000000027'), ('ord_pkg3', 'b1000000-0000-0000-0000-000000000028'),
  ('item1', 'b1000000-0000-0000-0000-000000000031'), ('item_done', 'b1000000-0000-0000-0000-000000000032'),
  ('item_pkg', 'b1000000-0000-0000-0000-000000000033'), ('item_cancel', 'b1000000-0000-0000-0000-000000000034'),
  ('item_pkg2', 'b1000000-0000-0000-0000-000000000035'), ('item_pkg3', 'b1000000-0000-0000-0000-000000000036'),
  ('item_bedcover', 'b1000000-0000-0000-0000-000000000037'),
  ('cat1', 'b1000000-0000-0000-0000-000000000041'), ('cat2', 'b1000000-0000-0000-0000-000000000042'),
  ('pkg1', 'b1000000-0000-0000-0000-000000000043'),
  ('pay_dp', 'b1000000-0000-0000-0000-000000000051'), ('pay_done', 'b1000000-0000-0000-0000-000000000052'),
  ('pay_cancel', 'b1000000-0000-0000-0000-000000000053'),
  ('svc2', 'b2000000-0000-0000-0000-000000000001'), ('cust2', 'b2000000-0000-0000-0000-000000000002'),
  ('ord2', 'b2000000-0000-0000-0000-000000000003');

-- a second laundry on the same server, owned by someone else (created by the operator), with a few rows of its own
insert into public.organizations (id, name, created_by) values (zz.id('org2'), 'Laundry Lain', zz.id('owner2'));
insert into public.organization_members (org_id, user_id, email, role) values (zz.id('org2'), zz.id('owner2'), 'owner2@example.com', 'owner');
select zz.eq('other-laundry', 'its owner sets up a price list', 'ok:1', zz.att(zz.id('owner2'), format('insert into public.services (id, org_id, name, unit, price) values (%L, %L, %L, %L, 7000)', zz.id('svc2'), zz.id('org2'), 'Cuci kering', 'kg'), true));
select zz.eq('other-laundry', '... a customer', 'ok:1', zz.att(zz.id('owner2'), format('insert into public.customers (id, org_id, name) values (%L, %L, %L)', zz.id('cust2'), zz.id('org2'), 'Pelanggan Lain'), true));
select zz.eq('other-laundry', '... and an order numbered like ours will be', 'ok:1', zz.att(zz.id('owner2'), format('insert into public.orders (id, org_id, order_number, customer_id) values (%L, %L, %L, %L)', zz.id('ord2'), zz.id('org2'), 'LD-202610-0002', zz.id('cust2')), true));

-- 1. Price list and package catalog: admin writes, staff reads (SPEC 3.1, 3.4, 3.10)
do $$
declare
  o uuid := zz.id('owner');
  a uuid := zz.id('wife');
  s uuid := zz.id('staff');
  org uuid := zz.id('org1');
  svc text := 'insert into public.services (id, org_id, name, unit, price, price_express, days_regular, days_express, min_qty, sort_order) values (%L, %L, %L, %L, %s, %s, %s, %s, %s, %s)';
begin
  perform zz.eq('services', 'owner adds Cuci kering', 'ok:1', zz.att(o, format(svc, zz.id('svc_kering'), org, 'Cuci kering', 'kg', 6000, 10000, 3, 1, 2, 1), true));
  -- updated_at backdated on purpose: the whole block shares one now(), so only the trigger can move it forward
  perform zz.eq('services', 'admin adds Cuci setrika', 'ok:1', zz.att(a, format(
    'insert into public.services (id, org_id, name, unit, price, price_express, days_regular, days_express, min_qty, sort_order, updated_at) values (%L, %L, %L, %L, 8000, 13000, 3, 1, 2, 2, %L)',
    zz.id('svc_setrika'), org, 'Cuci setrika', 'kg', '2020-01-01'), true));
  perform zz.eq('services', 'admin adds Setrika saja (no express)', 'ok:1', zz.att(a, format(svc, zz.id('svc_setrika_saja'), org, 'Setrika saja', 'kg', 5000, 'null', 2, 'null', 0, 3), true));
  perform zz.eq('services', 'owner adds Bed cover (pcs)', 'ok:1', zz.att(o, format(svc, zz.id('svc_bedcover'), org, 'Bed cover', 'pcs', 25000, 'null', 3, 'null', 0, 4), true));
  perform zz.chk('services', 'staff cannot add a service', '^err:42501', zz.att(s, format(svc, gen_random_uuid(), org, 'Sepatu', 'pcs', 35000, 'null', 4, 'null', 0, 5)));
  perform zz.eq('services', 'staff cannot change a price', 'ok:0', zz.att(s, 'update public.services set price = 1'));
  perform zz.eq('services', 'staff cannot deactivate a service', 'ok:0', zz.att(s, 'update public.services set active = false'));
  perform zz.eq('services', 'staff cannot delete a service', 'ok:0', zz.att(s, 'delete from public.services'));
  perform zz.eq('services', 'staff reads the price list', 'val:4', zz.val(s, 'select count(*) from public.services'));
  perform zz.eq('services', 'admin raises a price', 'ok:1', zz.att(a, format('update public.services set price = 9000 where id = %L', zz.id('svc_setrika')), true));
  perform zz.ok('services', '... updated_at moved (set_updated_at)', (select updated_at > '2021-01-01' from public.services where id = zz.id('svc_setrika')));
  perform zz.eq('services', 'admin puts the price back', 'ok:1', zz.att(a, format('update public.services set price = 8000 where id = %L', zz.id('svc_setrika')), true));
  perform zz.chk('services', 'unit must be kg or pcs', '^err:23514', zz.att(o, format(svc, gen_random_uuid(), org, 'Karpet', 'm2', 1, 'null', 1, 'null', 0, 9)));
  perform zz.chk('services', 'price cannot be negative', '^err:23514', zz.att(o, format(svc, gen_random_uuid(), org, 'Gratis', 'kg', -1, 'null', 1, 'null', 0, 9)));
  perform zz.chk('services', 'min_qty cannot be negative', '^err:23514', zz.att(o, format(svc, gen_random_uuid(), org, 'X', 'kg', 1, 'null', 1, 'null', -1, 9)));
  perform zz.chk('services', 'owner cannot add a service to another laundry', '^err:42501', zz.att(o, format(svc, gen_random_uuid(), zz.id('org2'), 'Sepatu', 'pcs', 1, 'null', 1, 'null', 0, 9)));

  perform zz.eq('catalog', 'owner adds a package to the catalog', 'ok:1', zz.att(o, format(
    'insert into public.package_catalog (id, org_id, name, service_id, qty, price, valid_days) values (%L, %L, %L, %L, 20, 140000, 60)', zz.id('cat1'), org, 'Paket 20 kg cuci setrika', zz.id('svc_setrika')), true));
  perform zz.chk('catalog', 'staff cannot add to the catalog', '^err:42501', zz.att(s, format(
    'insert into public.package_catalog (org_id, name, service_id, qty, price) values (%L, %L, %L, 10, 1)', org, 'Paket staf', zz.id('svc_setrika'))));
  perform zz.eq('catalog', 'staff cannot change a package price', 'ok:0', zz.att(s, 'update public.package_catalog set price = 1'));
  perform zz.eq('catalog', 'staff cannot delete a package', 'ok:0', zz.att(s, 'delete from public.package_catalog'));
  perform zz.eq('catalog', 'staff reads the catalog', 'val:1', zz.val(s, 'select count(*) from public.package_catalog'));
  perform zz.chk('catalog', 'qty must be positive', '^err:23514', zz.att(o, format(
    'insert into public.package_catalog (org_id, name, service_id, qty, price) values (%L, %L, %L, 0, 1)', org, 'Kosong', zz.id('svc_setrika'))));
  perform zz.chk('catalog', 'a package for a service of another laundry is refused (composite FK)', '^err:23503', zz.att(o, format(
    'insert into public.package_catalog (org_id, name, service_id, qty, price) values (%L, %L, %L, 1, 1)', org, 'Lintas', zz.id('svc2'))));
end $$;

-- 2. Customers: every member adds and edits; only admins delete (SPEC 3.2, 3.10)
do $$
declare
  a uuid := zz.id('wife');
  s uuid := zz.id('staff');
  org uuid := zz.id('org1');
begin
  perform zz.eq('customers', 'staff adds a kos tenant', 'ok:1', zz.att(s, format(
    'insert into public.customers (id, org_id, name, phone, is_tenant, room_name) values (%L, %L, %L, %L, true, %L)', zz.id('cust_rina'), org, 'Rina Putri', '0812-0000-0001', 'B3'), true));
  -- updated_at backdated on purpose: the whole block shares one now(), so only the trigger can move it forward
  perform zz.eq('customers', 'staff adds a walk-in without a phone', 'ok:1', zz.att(s, format(
    'insert into public.customers (id, org_id, name, updated_at) values (%L, %L, %L, %L)', zz.id('cust_hendra'), org, 'Pak Hendra', '2020-01-01'), true));
  perform zz.eq('customers', 'staff adds one more', 'ok:1', zz.att(s, format(
    'insert into public.customers (id, org_id, name) values (%L, %L, %L)', zz.id('cust_unused'), org, 'Sekali lewat'), true));
  perform zz.eq('customers', 'staff fills in the phone later', 'ok:1', zz.att(s, format('update public.customers set phone = %L where id = %L', '0812-0000-0006', zz.id('cust_hendra')), true));
  perform zz.ok('customers', '... updated_at moved (set_updated_at)', (select updated_at > '2021-01-01' from public.customers where id = zz.id('cust_hendra')));
  perform zz.eq('customers', 'defaults: not a tenant, no room', 'false|-|-', (select is_tenant::text || '|' || coalesce(room_name, '-') || '|' || coalesce(kos_tenant_id, '-') from public.customers where id = zz.id('cust_hendra')));
  perform zz.eq('customers', 'staff cannot delete a customer', 'ok:0', zz.att(s, format('delete from public.customers where id = %L', zz.id('cust_unused'))));
  perform zz.eq('customers', 'admin deletes an unused customer', 'ok:1', zz.att(a, format('delete from public.customers where id = %L', zz.id('cust_unused')), true));
  perform zz.eq('customers', 'stranger sees no customers', 'val:0', zz.val(zz.id('stranger'), 'select count(*) from public.customers'));
  perform zz.chk('customers', 'stranger cannot add a customer', '^err:42501', zz.att(zz.id('stranger'), format('insert into public.customers (org_id, name) values (%L, %L)', org, 'Penyusup')));
  perform zz.chk('customers', 'anon cannot read customers', '^err:42501', zz.val(null, 'select count(*) from public.customers'));
end $$;

-- 3. Orders, items and payments by staff; the constraints (SPEC 3.3, 3.5, 3.12)
do $$
declare
  o uuid := zz.id('owner');
  a uuid := zz.id('wife');
  s uuid := zz.id('staff');
  org uuid := zz.id('org1');
  ord text := 'insert into public.orders (id, org_id, order_number, customer_id, received_at, promised_at, express) values (%L, %L, %L, %L, %L, %L, %s)';
  ord_plain text := 'insert into public.orders (id, org_id, order_number, customer_id, received_at) values (%L, %L, %L, %L, %L)';
  item text := 'insert into public.order_items (id, org_id, order_id, service_id, service_name, unit, unit_price, qty, line_total) values (%L, %L, %L, %L, %L, %L, %s, %s, %s)';
  pay text := 'insert into public.payments (id, org_id, order_id, amount, paid_at, method) values (%L, %L, %L, %s, %L, %L)';
begin
  perform zz.eq('orders', 'staff records an order', 'ok:1', zz.att(s, format(ord, zz.id('ord1'), org, 'LD-202610-0001', zz.id('cust_rina'), '2026-10-19', '2026-10-22', 'false'), true));
  perform zz.eq('orders', 'defaults: received, no discount, nothing marked', 'received|0|-|-', (select status || '|' || discount || '|' || coalesce(ready_at::text, '-') || '|' || coalesce(picked_up_at::text, '-') from public.orders where id = zz.id('ord1')));
  perform zz.eq('orders', 'staff adds 2.5 kg Cuci setrika', 'ok:1', zz.att(s, format(item, zz.id('item1'), org, zz.id('ord1'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', 8000, 2.5, 20000), true));
  perform zz.eq('orders', 'qty keeps two decimals', '2.50', (select qty::text from public.order_items where id = zz.id('item1')));
  perform zz.chk('orders', 'line_total must be round(qty x unit_price)', '^err:23514', zz.att(s, format(item, gen_random_uuid(), org, zz.id('ord1'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', 8000, 2.5, 19999)));
  perform zz.eq('orders', 'rounding: 2.55 x 7.001 = 17.853 (17852.55 rounds up)', 'ok:1', zz.att(s, format(item, gen_random_uuid(), org, zz.id('ord1'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', 7001, 2.55, 17853)));
  perform zz.chk('orders', 'qty must be positive', '^err:23514', zz.att(s, format(item, gen_random_uuid(), org, zz.id('ord1'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', 8000, 0, 0)));
  perform zz.chk('orders', 'pcs must be whole', '^err:23514', zz.att(s, format(item, gen_random_uuid(), org, zz.id('ord1'), zz.id('svc_bedcover'), 'Bed cover', 'pcs', 25000, 1.5, 37500)));
  perform zz.chk('orders', 'unit must be kg or pcs', '^err:23514', zz.att(s, format(item, gen_random_uuid(), org, zz.id('ord1'), zz.id('svc_bedcover'), 'Bed cover', 'lembar', 25000, 1, 25000)));
  perform zz.chk('orders', 'unit_price cannot be negative', '^err:23514', zz.att(s, format(item, gen_random_uuid(), org, zz.id('ord1'), zz.id('svc_bedcover'), 'Bed cover', 'pcs', -1, 1, -1)));
  perform zz.chk('orders', 'status is one of the five', '^err:23514', zz.att(s, format('update public.orders set status = ''lost'' where id = %L', zz.id('ord1'))));
  perform zz.chk('orders', 'discount cannot be negative', '^err:23514', zz.att(s, format('update public.orders set discount = -1 where id = %L', zz.id('ord1'))));
  perform zz.chk('orders', 'order number is unique per laundry', '^err:23505:.*orders_org_id_order_number_key', zz.att(s, format(ord_plain, gen_random_uuid(), org, 'LD-202610-0001', zz.id('cust_hendra'), '2026-10-19')));
  perform zz.eq('orders', 'the same number in another laundry is fine (it already exists there)', 'val:1', zz.val(zz.id('owner2'), format('select count(*) from public.orders where order_number = %L', 'LD-202610-0002')));
  perform zz.chk('orders', 'an order for a customer of another laundry is refused (composite FK)', '^err:23503', zz.att(s, format(ord_plain, gen_random_uuid(), org, 'LD-202610-0099', zz.id('cust2'), '2026-10-19')));
  perform zz.chk('orders', 'an item on an order of another laundry is refused (composite FK)', '^err:23503', zz.att(s, format(item, gen_random_uuid(), org, zz.id('ord2'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', 8000, 1, 8000)));
  perform zz.chk('orders', 'an item for a service of another laundry is refused (composite FK)', '^err:23503', zz.att(s, format(item, gen_random_uuid(), org, zz.id('ord1'), zz.id('svc2'), 'Cuci kering', 'kg', 7000, 1, 7000)));
  perform zz.eq('orders', 'an item may copy a service that no longer exists (service_id null)', 'ok:1', zz.att(s, format(
    'insert into public.order_items (org_id, order_id, service_id, service_name, unit, unit_price, qty, line_total) values (%L, %L, null, %L, %L, 1000, 1, 1000)', org, zz.id('ord1'), 'Lama', 'kg')));
  perform zz.eq('orders', 'staff edits the item (3 kg)', 'ok:1', zz.att(s, format('update public.order_items set qty = 3, line_total = 24000 where id = %L', zz.id('item1')), true));
  perform zz.eq('orders', 'staff adds a discount', 'ok:1', zz.att(s, format('update public.orders set discount = 4000 where id = %L', zz.id('ord1')), true));
  perform zz.eq('orders', 'staff starts processing', 'ok:1', zz.att(s, format('update public.orders set status = ''processing'' where id = %L', zz.id('ord1')), true));
  perform zz.eq('orders', 'staff marks it ready', 'ok:1', zz.att(s, format('update public.orders set status = ''ready'', ready_at = now() where id = %L', zz.id('ord1')), true));

  -- payments: total is 24.000 - 4.000 = 20.000
  perform zz.eq('payments', 'staff takes a DP', 'ok:1', zz.att(s, format(pay, zz.id('pay_dp'), org, zz.id('ord1'), 5000, '2026-10-19', 'qris'), true));
  perform zz.eq('payments', 'created_by is the staff member', zz.id('staff')::text, (select created_by::text from public.payments where id = zz.id('pay_dp')));
  perform zz.eq('payments', 'a payment claiming the owner as author -> staff', 'val:' || s, zz.val(s, format(
    'with i as (insert into public.payments (org_id, order_id, amount, paid_at, created_by) values (%L, %L, 1000, %L, %L) returning created_by) select created_by from i', org, zz.id('ord1'), '2026-10-19', o)));
  perform zz.eq('payments', 'more than the outstanding 15.000 is refused', 'err:P0001:Pembayaran melebihi total pesanan.',
    zz.att(s, format(pay, gen_random_uuid(), org, zz.id('ord1'), 15001, '2026-10-19', 'cash')));
  perform zz.eq('payments', 'exactly the outstanding amount is fine', 'ok:1', zz.att(s, format(pay, gen_random_uuid(), org, zz.id('ord1'), 15000, '2026-10-19', 'cash')));
  perform zz.chk('payments', 'amount must be positive', '^err:23514', zz.att(s, format(pay, gen_random_uuid(), org, zz.id('ord1'), 0, '2026-10-19', 'cash')));
  perform zz.chk('payments', 'method is cash/transfer/qris', '^err:23514', zz.att(s, format(pay, gen_random_uuid(), org, zz.id('ord1'), 1, '2026-10-19', 'hutang')));
  perform zz.chk('payments', 'a payment on an order of another laundry is refused (composite FK)', '^err:23503', zz.att(s, format(pay, gen_random_uuid(), org, zz.id('ord2'), 1, '2026-10-19', 'cash')));
  perform zz.eq('payments', 'staff cannot change a payment', 'ok:0', zz.att(s, format('update public.payments set amount = 1 where id = %L', zz.id('pay_dp'))));
  perform zz.eq('payments', 'staff cannot delete a payment', 'ok:0', zz.att(s, format('delete from public.payments where id = %L', zz.id('pay_dp'))));
  perform zz.eq('payments', 'admin corrects the payment to 10.000', 'ok:1', zz.att(a, format('update public.payments set amount = 10000, method = ''transfer'' where id = %L', zz.id('pay_dp')), true));
  perform zz.eq('payments', 'admin cannot correct it above the total', 'err:P0001:Pembayaran melebihi total pesanan.', zz.att(a, format('update public.payments set amount = 20001 where id = %L', zz.id('pay_dp'))));
  perform zz.eq('payments', 'admin cannot rewrite the author', 'val:' || s, zz.val(a, format('with u as (update public.payments set created_by = %L where id = %L returning created_by) select created_by from u', a, zz.id('pay_dp'))));
  -- the total may not drop below what was paid (10.000): discount, item edit, item delete
  perform zz.eq('payments', 'a discount that drops the total below the paid amount is refused', 'err:P0001:Pembayaran melebihi total pesanan.', zz.att(s, format('update public.orders set discount = 14001 where id = %L', zz.id('ord1'))));
  perform zz.eq('payments', 'a discount down to the paid amount is fine', 'ok:1', zz.att(s, format('update public.orders set discount = 14000 where id = %L', zz.id('ord1'))));
  perform zz.eq('payments', 'shrinking the item below the paid amount is refused', 'err:P0001:Pembayaran melebihi total pesanan.', zz.att(s, format('update public.order_items set qty = 1, line_total = 8000 where id = %L', zz.id('item1'))));
  perform zz.eq('payments', 'deleting the item is refused while the payment stands', 'err:P0001:Pembayaran melebihi total pesanan.', zz.att(s, format('delete from public.order_items where id = %L', zz.id('item1'))));
  perform zz.eq('payments', 'adding an item first, then removing the old one, works', 'ok:1', zz.att(s, format(
    'with n as (insert into public.order_items (org_id, order_id, service_id, service_name, unit, unit_price, qty, line_total) values (%L, %L, %L, %L, %L, 8000, 2, 16000)) delete from public.order_items where id = %L',
    org, zz.id('ord1'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', zz.id('item1'))));

  -- a second order for Pak Hendra, picked up and settled: frozen for staff from then on
  perform zz.eq('done', 'staff records the order', 'ok:1', zz.att(s, format(ord, zz.id('ord_done'), org, 'LD-202610-0002', zz.id('cust_hendra'), '2026-10-15', '2026-10-18', 'false'), true));
  perform zz.eq('done', '... with a bed cover', 'ok:1', zz.att(s, format(item, zz.id('item_done'), org, zz.id('ord_done'), zz.id('svc_bedcover'), 'Bed cover', 'pcs', 25000, 1, 25000), true));
  perform zz.eq('done', 'staff marks it ready, then picked up', 'ok:1', zz.att(s, format('update public.orders set status = ''ready'', ready_at = now() where id = %L', zz.id('ord_done')), true));
  perform zz.eq('done', '... picked up', 'ok:1', zz.att(s, format('update public.orders set status = ''done'', picked_up_at = now() where id = %L', zz.id('ord_done')), true));
  perform zz.eq('done', 'staff settles it after pickup (payments are not frozen)', 'ok:1', zz.att(s, format(pay, zz.id('pay_done'), org, zz.id('ord_done'), 25000, '2026-10-18', 'cash'), true));
  perform zz.eq('done', 'staff cannot change a done order', 'err:P0001:Pesanan yang sudah selesai hanya bisa diubah pemilik/admin.', zz.att(s, format('update public.orders set notes = ''x'' where id = %L', zz.id('ord_done'))));
  perform zz.chk('done', 'staff cannot reopen it', 'hanya bisa diubah pemilik/admin', zz.att(s, format('update public.orders set status = ''ready'' where id = %L', zz.id('ord_done'))));
  perform zz.chk('done', 'staff cannot add an item to it', 'hanya bisa diubah pemilik/admin', zz.att(s, format(item, gen_random_uuid(), org, zz.id('ord_done'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', 8000, 1, 8000)));
  perform zz.chk('done', 'staff cannot edit its item', 'hanya bisa diubah pemilik/admin', zz.att(s, format('update public.order_items set notes = ''x'' where id = %L', zz.id('item_done'))));
  perform zz.chk('done', 'staff cannot delete its item', 'hanya bisa diubah pemilik/admin', zz.att(s, format('delete from public.order_items where id = %L', zz.id('item_done'))));
  perform zz.chk('done', 'staff cannot move an open item onto it', 'hanya bisa diubah pemilik/admin', zz.att(s, format('update public.order_items set order_id = %L where order_id = %L', zz.id('ord_done'), zz.id('ord1'))));
  perform zz.eq('done', 'admin edits the done order', 'ok:1', zz.att(a, format('update public.orders set notes = ''Diambil adiknya'' where id = %L', zz.id('ord_done')), true));
  perform zz.eq('done', 'admin edits its item', 'ok:1', zz.att(a, format('update public.order_items set notes = ''bed cover besar'' where id = %L', zz.id('item_done')), true));
  perform zz.eq('done', 'operator (no auth.uid) edits the done order', 'val:1', zz.su(format('with u as (update public.orders set notes = ''Operator'' where id = %L returning 1) select count(*) from u', zz.id('ord_done'))));
  perform zz.eq('done', 'staff cannot delete an order', 'ok:0', zz.att(s, format('delete from public.orders where id = %L', zz.id('ord_done'))));
  perform zz.chk('done', 'staff cannot bring the done order to another laundry', 'tidak dapat dipindah|^err:23503|hanya bisa diubah', zz.att(s, format('update public.orders set org_id = %L where id = %L', zz.id('org2'), zz.id('ord_done'))));
end $$;

-- 4. Cancelling (SPEC 3.3): only Diterima/Proses, only without payments
do $$
declare
  a uuid := zz.id('wife');
  s uuid := zz.id('staff');
  org uuid := zz.id('org1');
begin
  perform zz.eq('cancel', 'staff records an order with a DP', 'ok:1', zz.att(s, format(
    'insert into public.orders (id, org_id, order_number, customer_id, received_at) values (%L, %L, %L, %L, %L)', zz.id('ord_cancel'), org, 'LD-202610-0003', zz.id('cust_rina'), '2026-10-19'), true));
  perform zz.eq('cancel', '... item', 'ok:1', zz.att(s, format(
    'insert into public.order_items (id, org_id, order_id, service_id, service_name, unit, unit_price, qty, line_total) values (%L, %L, %L, %L, %L, %L, 6000, 4, 24000)',
    zz.id('item_cancel'), org, zz.id('ord_cancel'), zz.id('svc_kering'), 'Cuci kering', 'kg'), true));
  perform zz.eq('cancel', '... DP', 'ok:1', zz.att(s, format(
    'insert into public.payments (id, org_id, order_id, amount, paid_at) values (%L, %L, %L, 10000, %L)', zz.id('pay_cancel'), org, zz.id('ord_cancel'), '2026-10-19'), true));
  perform zz.eq('cancel', 'cancelling with a payment is refused', 'err:P0001:Pesanan yang sudah ada pembayarannya tidak dapat dibatalkan.',
    zz.att(s, format('update public.orders set status = ''cancelled'' where id = %L', zz.id('ord_cancel'))));
  perform zz.eq('cancel', '... for the admin too', 'err:P0001:Pesanan yang sudah ada pembayarannya tidak dapat dibatalkan.',
    zz.att(a, format('update public.orders set status = ''cancelled'' where id = %L', zz.id('ord_cancel'))));
  perform zz.eq('cancel', 'a ready order cannot be cancelled', 'err:P0001:Pesanan hanya dapat dibatalkan selama Diterima/Proses.',
    zz.att(s, format('update public.orders set status = ''cancelled'' where id = %L', zz.id('ord1'))));
  perform zz.chk('cancel', 'a done order cannot be cancelled (admin)', 'hanya dapat dibatalkan selama Diterima/Proses', zz.att(a, format('update public.orders set status = ''cancelled'' where id = %L', zz.id('ord_done'))));
  perform zz.eq('cancel', 'admin deletes the DP', 'ok:1', zz.att(a, format('delete from public.payments where id = %L', zz.id('pay_cancel')), true));
  perform zz.eq('cancel', 'now staff cancels', 'ok:1', zz.att(s, format('update public.orders set status = ''cancelled'' where id = %L', zz.id('ord_cancel')), true));
  perform zz.chk('cancel', 'staff cannot touch the cancelled order', 'hanya bisa diubah pemilik/admin', zz.att(s, format('update public.orders set notes = ''x'' where id = %L', zz.id('ord_cancel'))));
  perform zz.chk('cancel', '... nor its item', 'hanya bisa diubah pemilik/admin', zz.att(s, format('delete from public.order_items where id = %L', zz.id('item_cancel'))));
  perform zz.eq('cancel', 'admin reopens it', 'ok:1', zz.att(a, format('update public.orders set status = ''received'' where id = %L', zz.id('ord_cancel')), true));
  perform zz.eq('cancel', 'staff cancels it again', 'ok:1', zz.att(s, format('update public.orders set status = ''cancelled'' where id = %L', zz.id('ord_cancel')), true));
end $$;

-- 5. Prepaid packages (SPEC 3.4)
do $$
declare
  a uuid := zz.id('wife');
  s uuid := zz.id('staff');
  org uuid := zz.id('org1');
  ord text := 'insert into public.orders (id, org_id, order_number, customer_id, received_at) values (%L, %L, %L, %L, %L)';
  pitem text := 'insert into public.order_items (id, org_id, order_id, service_id, service_name, unit, unit_price, qty, line_total, customer_package_id) values (%L, %L, %L, %L, %L, %L, %s, %s, %s, %L)';
begin
  perform zz.eq('packages', 'staff sells a package to Rina', 'ok:1', zz.att(s, format(
    'insert into public.customer_packages (id, org_id, customer_id, catalog_id, name, service_id, qty_total, price, purchased_at, expires_at, method) values (%L, %L, %L, %L, %L, %L, 20, 140000, %L, %L, %L)',
    zz.id('pkg1'), org, zz.id('cust_rina'), zz.id('cat1'), 'Paket 20 kg cuci setrika', zz.id('svc_setrika'), '2026-10-01', '2026-11-30', 'transfer'), true));
  perform zz.chk('packages', 'qty_total must be positive', '^err:23514', zz.att(s, format(
    'insert into public.customer_packages (org_id, customer_id, name, service_id, qty_total, price) values (%L, %L, %L, %L, 0, 1)', org, zz.id('cust_rina'), 'x', zz.id('svc_setrika'))));
  perform zz.chk('packages', 'method is cash/transfer/qris', '^err:23514', zz.att(s, format(
    'insert into public.customer_packages (org_id, customer_id, name, service_id, qty_total, price, method) values (%L, %L, %L, %L, 1, 1, %L)', org, zz.id('cust_rina'), 'x', zz.id('svc_setrika'), 'bon')));
  perform zz.chk('packages', 'a package for a customer of another laundry is refused (composite FK)', '^err:23503', zz.att(s, format(
    'insert into public.customer_packages (org_id, customer_id, name, service_id, qty_total, price) values (%L, %L, %L, %L, 1, 1)', org, zz.id('cust2'), 'x', zz.id('svc_setrika'))));
  perform zz.eq('packages', 'staff may fix a note on the sold package', 'ok:1', zz.att(s, format('update public.customer_packages set notes = ''bayar transfer'' where id = %L', zz.id('pkg1'))));
  -- anything else on a sale is a money correction (customer_packages_guard): owner/admin only
  perform zz.eq('packages', 'staff cannot zero the price of a sold package', 'err:P0001:Paket yang sudah terjual hanya bisa diubah pemilik/admin.',
    zz.att(s, format('update public.customer_packages set price = 0 where id = %L', zz.id('pkg1'))));
  perform zz.eq('packages', '... nor change its method or purchase date', 'err:P0001:Paket yang sudah terjual hanya bisa diubah pemilik/admin.',
    zz.att(s, format('update public.customer_packages set method = ''qris'', purchased_at = ''2026-09-01'' where id = %L', zz.id('pkg1'))));
  perform zz.eq('packages', '... nor move it to another customer', 'err:P0001:Paket yang sudah terjual hanya bisa diubah pemilik/admin.',
    zz.att(s, format('update public.customer_packages set customer_id = %L where id = %L', zz.id('cust_hendra'), zz.id('pkg1'))));
  perform zz.eq('packages', '... nor raise its qty or extend it', 'err:P0001:Paket yang sudah terjual hanya bisa diubah pemilik/admin.',
    zz.att(s, format('update public.customer_packages set qty_total = 200, expires_at = null where id = %L', zz.id('pkg1'))));
  perform zz.eq('packages', '... nor together with a note', 'err:P0001:Paket yang sudah terjual hanya bisa diubah pemilik/admin.',
    zz.att(s, format('update public.customer_packages set notes = ''x'', price = 1 where id = %L', zz.id('pkg1'))));
  perform zz.eq('packages', 'admin corrects the price of a sold package', 'ok:1', zz.att(a, format('update public.customer_packages set price = 135000 where id = %L', zz.id('pkg1'))));
  perform zz.eq('packages', 'operator (no auth.uid) corrects it too', 'val:1', zz.su(format('with u as (update public.customer_packages set price = 135000 where id = %L returning 1) select count(*) from u', zz.id('pkg1'))));
  perform zz.eq('packages', 'the price stayed as sold', '140000', (select price::text from public.customer_packages where id = zz.id('pkg1')));
  perform zz.eq('packages', 'staff cannot delete a sold package', 'ok:0', zz.att(s, format('delete from public.customer_packages where id = %L', zz.id('pkg1'))));

  perform zz.eq('packages', 'staff records an order for Rina', 'ok:1', zz.att(s, format(ord, zz.id('ord_pkg'), org, 'LD-202610-0004', zz.id('cust_rina'), '2026-10-19'), true));
  perform zz.eq('packages', 'staff records an order for Pak Hendra', 'ok:1', zz.att(s, format(ord, zz.id('ord_hendra'), org, 'LD-202610-0005', zz.id('cust_hendra'), '2026-10-19'), true));
  perform zz.eq('packages', 'an order received after the package expires', 'ok:1', zz.att(s, format(ord, zz.id('ord_late'), org, 'LD-202612-0001', zz.id('cust_rina'), '2026-12-01'), true));
  perform zz.eq('packages', '5 kg from the package (free line)', 'ok:1', zz.att(s, format(pitem, zz.id('item_pkg'), org, zz.id('ord_pkg'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', 0, 5, 0, zz.id('pkg1')), true));
  perform zz.chk('packages', 'a package line is never priced', '^err:23514', zz.att(s, format(pitem, gen_random_uuid(), org, zz.id('ord_pkg'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', 8000, 1, 8000, zz.id('pkg1'))));
  perform zz.eq('packages', 'another customer cannot use it', 'err:P0001:Paket ini milik pelanggan lain.', zz.att(s, format(pitem, gen_random_uuid(), org, zz.id('ord_hendra'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', 0, 1, 0, zz.id('pkg1'))));
  perform zz.eq('packages', 'another service cannot use it', 'err:P0001:Paket ini tidak berlaku untuk layanan tersebut.', zz.att(s, format(pitem, gen_random_uuid(), org, zz.id('ord_pkg'), zz.id('svc_kering'), 'Cuci kering', 'kg', 0, 1, 0, zz.id('pkg1'))));
  perform zz.eq('packages', 'an expired package cannot be used', 'err:P0001:Paket sudah kedaluwarsa pada tanggal masuk pesanan.', zz.att(s, format(pitem, gen_random_uuid(), org, zz.id('ord_late'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', 0, 1, 0, zz.id('pkg1'))));
  perform zz.eq('packages', 'more than the remaining 15 kg is refused', 'err:P0001:Sisa paket tidak cukup.', zz.att(s, format(pitem, gen_random_uuid(), org, zz.id('ord_pkg'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', 0, 15.5, 0, zz.id('pkg1'))));
  perform zz.eq('packages', 'exactly the remaining 15 kg is fine', 'ok:1', zz.att(s, format(pitem, gen_random_uuid(), org, zz.id('ord_pkg'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', 0, 15, 0, zz.id('pkg1'))));
  perform zz.eq('packages', 'raising the line above the remaining qty is refused', 'err:P0001:Sisa paket tidak cukup.', zz.att(s, format('update public.order_items set qty = 20.5 where id = %L', zz.id('item_pkg'))));
  perform zz.eq('packages', 'a cancelled order gives its qty back', 'ok:1', zz.att(s, format('update public.orders set status = ''cancelled'' where id = %L', zz.id('ord_pkg')), true));
  perform zz.eq('packages', '... 20 kg available again', 'ok:1', zz.att(s, format(ord, zz.id('ord_pkg2'), org, 'LD-202610-0006', zz.id('cust_rina'), '2026-10-20'), true));
  perform zz.eq('packages', '... used by a new order (16 kg)', 'ok:1', zz.att(s, format(pitem, zz.id('item_pkg2'), org, zz.id('ord_pkg2'), zz.id('svc_setrika'), 'Cuci setrika', 'kg', 0, 16, 0, zz.id('pkg1')), true));
  perform zz.eq('packages', 'reopening the cancelled order (5 kg) now exceeds the package', 'err:P0001:Sisa paket tidak cukup.', zz.att(a, format('update public.orders set status = ''received'' where id = %L', zz.id('ord_pkg'))));
  perform zz.eq('packages', 'admin deletes the new order (cascade)', 'ok:1', zz.att(a, format('delete from public.orders where id = %L', zz.id('ord_pkg2')), true));
  perform zz.eq('packages', '... its item went with it', '0', (select count(*)::text from public.order_items where id = zz.id('item_pkg2')));
  perform zz.eq('packages', '... and the cancelled order reopens', 'ok:1', zz.att(a, format('update public.orders set status = ''received'' where id = %L', zz.id('ord_pkg')), true));
  perform zz.eq('packages', 'moving the order to another customer is refused', 'err:P0001:Paket ini milik pelanggan lain.', zz.att(s, format('update public.orders set customer_id = %L where id = %L', zz.id('cust_hendra'), zz.id('ord_pkg'))));
  perform zz.eq('packages', 'dating the order after the expiry is refused', 'err:P0001:Paket sudah kedaluwarsa pada tanggal masuk pesanan.', zz.att(s, format('update public.orders set received_at = ''2026-12-05'' where id = %L', zz.id('ord_pkg'))));
  perform zz.chk('packages', 'a used package cannot be deleted (restrict)', '^err:23503', zz.att(a, format('delete from public.customer_packages where id = %L', zz.id('pkg1'))));
  perform zz.chk('packages', 'a customer with a package cannot be deleted (restrict)', '^err:23503', zz.att(a, format('delete from public.customers where id = %L', zz.id('cust_rina'))));
  perform zz.chk('packages', 'a service with packages cannot be deleted (restrict)', '^err:23503', zz.att(a, format('delete from public.services where id = %L', zz.id('svc_setrika'))));
  perform zz.eq('packages', 'admin removes the catalog entry', 'ok:1', zz.att(a, format('delete from public.package_catalog where id = %L', zz.id('cat1')), true));
  perform zz.ok('packages', '... the sold package stays, without a catalog link (set null)', (select catalog_id is null and name = 'Paket 20 kg cuci setrika' from public.customer_packages where id = zz.id('pkg1')));
  perform zz.eq('packages', 'owner puts a new package in the catalog', 'ok:1', zz.att(zz.id('owner'), format(
    'insert into public.package_catalog (id, org_id, name, service_id, qty, price) values (%L, %L, %L, %L, 10, 50000)', zz.id('cat2'), org, 'Paket 10 kg cuci kering', zz.id('svc_kering')), true));
end $$;

-- 6. Deleting a service clears the items' link but keeps the copies; cascade of an order with payments
do $$
declare
  a uuid := zz.id('wife');
  s uuid := zz.id('staff');
  org uuid := zz.id('org1');
begin
  perform zz.eq('delete', 'admin adds a bed cover line to the open order', 'ok:1', zz.att(a, format(
    'insert into public.order_items (id, org_id, order_id, service_id, service_name, unit, unit_price, qty, line_total) values (%L, %L, %L, %L, %L, %L, 25000, 1, 25000)',
    zz.id('item_bedcover'), org, zz.id('ord1'), zz.id('svc_bedcover'), 'Bed cover', 'pcs'), true));
  perform zz.eq('delete', 'admin deletes the Bed cover service', 'ok:1', zz.att(a, format('delete from public.services where id = %L', zz.id('svc_bedcover')), true));
  perform zz.eq('delete', '... the lines keep their copy, without the service (set null)', '2', (select count(*)::text from public.order_items where service_name = 'Bed cover' and service_id is null and unit_price = 25000));
  perform zz.eq('delete', 'staff cannot delete an order', 'ok:0', zz.att(s, format('delete from public.orders where id = %L', zz.id('ord1'))));
  perform zz.chk('delete', 'a customer with orders cannot be deleted', '^err:23503', zz.att(a, format('delete from public.customers where id = %L', zz.id('cust_hendra'))));
  perform zz.eq('delete', 'admin deletes the first order', 'ok:1', zz.att(a, format('delete from public.orders where id = %L', zz.id('ord1')), true));
  perform zz.eq('delete', '... its items and payments went with it (cascade)', '0|0', (select (select count(*) from public.order_items where order_id = zz.id('ord1')) || '|' || (select count(*) from public.payments where order_id = zz.id('ord1'))));
end $$;

-- 7. Isolation between organisations
do $$
declare
  o uuid := zz.id('owner');
  s uuid := zz.id('staff');
  o2 uuid := zz.id('owner2');
  org uuid := zz.id('org1');
  org2 uuid := zz.id('org2');
begin
  perform zz.eq('isolation', 'our staff sees none of the other laundry', 'val:0|0|0', zz.val(s, format('select (select count(*) from public.services where org_id = %L) || ''|'' || (select count(*) from public.customers where org_id = %L) || ''|'' || (select count(*) from public.orders where org_id = %L)', org2, org2, org2)));
  perform zz.eq('isolation', 'the other owner sees none of ours', 'val:0|0|0|0', zz.val(o2, format('select (select count(*) from public.customers where org_id = %L) || ''|'' || (select count(*) from public.orders where org_id = %L) || ''|'' || (select count(*) from public.payments where org_id = %L) || ''|'' || (select count(*) from public.customer_packages where org_id = %L)', org, org, org, org)));
  perform zz.chk('isolation', 'our owner cannot add a customer there', '^err:42501', zz.att(o, format('insert into public.customers (org_id, name) values (%L, %L)', org2, 'Penyusup')));
  perform zz.eq('isolation', 'our owner cannot change their price', 'ok:0', zz.att(o, format('update public.services set price = 1 where id = %L', zz.id('svc2'))));
  perform zz.eq('isolation', 'our owner cannot delete their order', 'ok:0', zz.att(o, format('delete from public.orders where id = %L', zz.id('ord2'))));
  perform zz.chk('isolation', 'our order cannot point at their customer', '^err:23503', zz.att(s, format('insert into public.orders (org_id, order_number, customer_id) values (%L, %L, %L)', org, 'LD-202610-0090', zz.id('cust2'))));
  perform zz.chk('isolation', 'our item cannot sit on their order', '^err:23503', zz.att(s, format('insert into public.order_items (org_id, order_id, service_name, unit, unit_price, qty, line_total) values (%L, %L, %L, %L, 1, 1, 1)', org, zz.id('ord2'), 'x', 'kg')));
  perform zz.chk('isolation', 'our payment cannot sit on their order', '^err:23503', zz.att(s, format('insert into public.payments (org_id, order_id, amount, paid_at) values (%L, %L, 1, %L)', org, zz.id('ord2'), '2026-10-19')));
  perform zz.chk('isolation', 'a customer cannot be moved to another laundry', 'tidak dapat dipindah|^err:23503', zz.att(o, format('update public.customers set org_id = %L where id = %L', org2, zz.id('cust_hendra'))));
  perform zz.chk('isolation', 'nor a service', 'tidak dapat dipindah|^err:23503', zz.att(o, format('update public.services set org_id = %L where id = %L', org2, zz.id('svc_kering'))));
  perform zz.chk('isolation', 'nor a payment', 'tidak dapat dipindah|^err:23503', zz.att(o, format('update public.payments set org_id = %L where id = %L', org2, zz.id('pay_done'))));
  perform zz.eq('isolation', 'the other owner sees only own rows', 'val:1|1|1', zz.val(o2, 'select (select count(*) from public.services) || ''|'' || (select count(*) from public.customers) || ''|'' || (select count(*) from public.orders)'));
end $$;

-- 8. Audit rows for the laundry tables (SPEC 2.3)
do $$
declare
  s uuid := zz.id('staff');
  a uuid := zz.id('wife');
begin
  perform zz.ok('audit', 'service added by the owner, with its price', exists (select 1 from public.audit_log
    where table_name = 'services' and action = 'insert' and row_id = zz.id('svc_kering') and changed_by = zz.id('owner') and (new_data ->> 'price')::bigint = 6000));
  perform zz.ok('audit', 'price change by the admin, old and new', exists (select 1 from public.audit_log
    where table_name = 'services' and action = 'update' and row_id = zz.id('svc_setrika') and changed_by = a and old_data ->> 'price' = '8000' and new_data ->> 'price' = '9000'));
  perform zz.ok('audit', 'customer added by staff', exists (select 1 from public.audit_log
    where table_name = 'customers' and action = 'insert' and row_id = zz.id('cust_rina') and changed_by = s and new_data ->> 'name' = 'Rina Putri'));
  perform zz.ok('audit', 'status change by staff', exists (select 1 from public.audit_log
    where table_name = 'orders' and action = 'update' and row_id = zz.id('ord_done') and changed_by = s and old_data ->> 'status' = 'ready' and new_data ->> 'status' = 'done'));
  perform zz.ok('audit', 'payment taken by staff and corrected by the admin', exists (select 1 from public.audit_log
    where table_name = 'payments' and action = 'insert' and row_id = zz.id('pay_dp') and changed_by = s)
    and exists (select 1 from public.audit_log where table_name = 'payments' and action = 'update' and row_id = zz.id('pay_dp') and changed_by = a and old_data ->> 'amount' = '5000' and new_data ->> 'amount' = '10000'));
  perform zz.ok('audit', 'deleted order and its cascaded rows are in the history', exists (select 1 from public.audit_log
    where table_name = 'orders' and action = 'delete' and row_id = zz.id('ord1') and changed_by = a and old_data ->> 'order_number' = 'LD-202610-0001')
    and exists (select 1 from public.audit_log where table_name = 'payments' and action = 'delete' and row_id = zz.id('pay_dp'))
    and exists (select 1 from public.audit_log where table_name = 'order_items' and action = 'delete' and old_data ->> 'order_id' = zz.id('ord1')::text));
  perform zz.ok('audit', 'package sold and catalog removed', exists (select 1 from public.audit_log where table_name = 'customer_packages' and action = 'insert' and row_id = zz.id('pkg1') and changed_by = s)
    and exists (select 1 from public.audit_log where table_name = 'package_catalog' and action = 'delete' and row_id = zz.id('cat1') and changed_by = a));
  perform zz.ok('audit', 'refused changes leave no trace', not exists (select 1 from public.audit_log where new_data ->> 'notes' = 'x' or new_data ->> 'order_number' = 'LD-202610-0090'));
  perform zz.eq('audit', 'staff reads no history', 'val:0', zz.val(s, 'select count(*) from public.audit_log'));
  perform zz.chk('audit', 'admin reads the laundry history', '^val:[1-9]', zz.val(a, 'select count(*) from public.audit_log where table_name in (''orders'', ''payments'')'));
end $$;

-- rows stay in every laundry table for the re-apply scenario
select zz.eq('leftovers', 'every laundry table holds data', 'true', (
  select bool_and(n > 0)::text from (
    select (select count(*) from public.services) n union all select count(*) from public.customers union all select count(*) from public.orders
    union all select count(*) from public.order_items union all select count(*) from public.package_catalog
    union all select count(*) from public.customer_packages union all select count(*) from public.payments) x));
