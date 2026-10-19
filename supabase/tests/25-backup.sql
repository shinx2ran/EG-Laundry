-- Scheduled backups: export_backup() returns every organisation in the app's backup format, and the
-- eg_laundry_backup login role can run that function and nothing else. Also the keep-alive ping.
\set ON_ERROR_STOP on
select set_config('zz.suite', '25-backup', false);
select zz.reset_data();

select zz.user('owner', '11111111-2525-0000-0000-000000000001', 'owner@backup.test');
select zz.user('stranger', '44444444-2525-0000-0000-000000000004', 'stranger@backup.test');
select zz.su('select public.set_setup_code(''BACKUP-25'')', true);
select zz.join(zz.id('owner'), 'backup25');
insert into zz.ids select 'org', id from public.organizations;
select zz.eq('seed', 'laundry renamed', 'ok:1', zz.att(zz.id('owner'),
  format('update public.organizations set name = %L where id = %L', 'EG Laundry Cadangan', zz.id('org')), true));
select zz.eq('seed', 'invitation', '8', length(zz.invite('inv', zz.id('owner'), zz.id('org'), 'staff', 'Penjaga'))::text);
-- a little laundry data, through the API as the owner
insert into zz.ids values ('b_svc', 'b2500000-0000-0000-0000-000000000001'), ('b_cust', 'b2500000-0000-0000-0000-000000000002'),
  ('b_ord', 'b2500000-0000-0000-0000-000000000003'), ('b_cat', 'b2500000-0000-0000-0000-000000000004'), ('b_pkg', 'b2500000-0000-0000-0000-000000000005');
select zz.eq('seed', 'service', 'ok:1', zz.att(zz.id('owner'), format('insert into public.services (id, org_id, name, unit, price) values (%L, %L, %L, %L, 8000)', zz.id('b_svc'), zz.id('org'), 'Cuci setrika', 'kg'), true));
select zz.eq('seed', 'customer', 'ok:1', zz.att(zz.id('owner'), format('insert into public.customers (id, org_id, name, phone) values (%L, %L, %L, %L)', zz.id('b_cust'), zz.id('org'), 'Rina', '0812-0000-0001'), true));
select zz.eq('seed', 'order', 'ok:1', zz.att(zz.id('owner'), format('insert into public.orders (id, org_id, order_number, customer_id, received_at) values (%L, %L, %L, %L, %L)', zz.id('b_ord'), zz.id('org'), 'LD-202610-0001', zz.id('b_cust'), '2026-10-19'), true));
select zz.eq('seed', 'item', 'ok:1', zz.att(zz.id('owner'), format('insert into public.order_items (org_id, order_id, service_id, service_name, unit, unit_price, qty, line_total) values (%L, %L, %L, %L, %L, 8000, 2.5, 20000)', zz.id('org'), zz.id('b_ord'), zz.id('b_svc'), 'Cuci setrika', 'kg'), true));
select zz.eq('seed', 'payment', 'ok:1', zz.att(zz.id('owner'), format('insert into public.payments (org_id, order_id, amount, paid_at, method) values (%L, %L, 20000, %L, %L)', zz.id('org'), zz.id('b_ord'), '2026-10-19', 'qris'), true));
select zz.eq('seed', 'catalog', 'ok:1', zz.att(zz.id('owner'), format('insert into public.package_catalog (id, org_id, name, service_id, qty, price, valid_days) values (%L, %L, %L, %L, 20, 140000, 60)', zz.id('b_cat'), zz.id('org'), 'Paket 20 kg', zz.id('b_svc')), true));
select zz.eq('seed', 'sold package', 'ok:1', zz.att(zz.id('owner'), format('insert into public.customer_packages (id, org_id, customer_id, catalog_id, name, service_id, qty_total, price, purchased_at, expires_at) values (%L, %L, %L, %L, %L, %L, 20, 140000, %L, %L)', zz.id('b_pkg'), zz.id('org'), zz.id('b_cust'), zz.id('b_cat'), 'Paket 20 kg', zz.id('b_svc'), '2026-10-01', '2026-11-30'), true));

do $$
declare
  b jsonb := public.export_backup();
  f jsonb := b -> 0;
begin
  perform zz.eq('export', 'one file per organisation', '1', jsonb_array_length(b)::text);
  perform zz.eq('export', 'app backup format', 'exportedAt,orgName,tables,version',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(f) k));
  perform zz.eq('export', 'version 1', '1', f ->> 'version');
  perform zz.eq('export', 'organisation name', 'EG Laundry Cadangan', f ->> 'orgName');
  perform zz.eq('export', 'all organisation tables', 'audit_log,customer_packages,customers,invitations,order_items,orders,organization_members,organizations,package_catalog,payments,services',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(f -> 'tables') k));
  perform zz.eq('export', 'invitation row', 'Penjaga', f -> 'tables' -> 'invitations' -> 0 ->> 'label');
  perform zz.eq('export', 'members', '1', jsonb_array_length(f -> 'tables' -> 'organization_members')::text);
  perform zz.eq('export', 'laundry rows: one of each', '1,1,1,1,1,1,1', concat_ws(',',
    jsonb_array_length(f -> 'tables' -> 'services'), jsonb_array_length(f -> 'tables' -> 'customers'), jsonb_array_length(f -> 'tables' -> 'orders'),
    jsonb_array_length(f -> 'tables' -> 'order_items'), jsonb_array_length(f -> 'tables' -> 'package_catalog'),
    jsonb_array_length(f -> 'tables' -> 'customer_packages'), jsonb_array_length(f -> 'tables' -> 'payments')));
  perform zz.eq('export', 'order row as the app stores it', 'LD-202610-0001|' || zz.id('b_cust') || '|received|0',
    (f -> 'tables' -> 'orders' -> 0 ->> 'order_number') || '|' || (f -> 'tables' -> 'orders' -> 0 ->> 'customer_id') || '|' || (f -> 'tables' -> 'orders' -> 0 ->> 'status') || '|' || (f -> 'tables' -> 'orders' -> 0 ->> 'discount'));
  perform zz.eq('export', 'item qty keeps its decimals, the payment its author', '2.50|' || zz.id('owner'),
    (f -> 'tables' -> 'order_items' -> 0 ->> 'qty') || '|' || (f -> 'tables' -> 'payments' -> 0 ->> 'created_by'));
  perform zz.eq('export', 'organisation row carries the WhatsApp texts', 'true', (f -> 'tables' -> 'organizations' -> 0 ? 'promo_template' and f -> 'tables' -> 'organizations' -> 0 ? 'wa_footer')::text);
  perform zz.ok('export', 'history included', jsonb_array_length(f -> 'tables' -> 'audit_log') > 0);
  perform zz.ok('export', 'no code hashes anywhere', position(encode(sha256(convert_to('BACKUP25', 'UTF8')), 'hex') in b::text) = 0
    and not (f -> 'tables' ? 'invitation_codes') and not (f -> 'tables' ? 'app_settings') and not (f -> 'tables' ? 'join_attempts'));
  perform zz.ok('export', 'exportedAt is an ISO time', (f ->> 'exportedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$');
end $$;

-- as the backup role: the export works, nothing else does (results are recorded after switching back)
do $$
declare
  n int;
  read_members text := 'allowed';
  read_settings text := 'allowed';
  write_org text := 'allowed';
  call_rpc text := 'allowed';
begin
  execute 'set local role eg_laundry_backup';
  n := jsonb_array_length(public.export_backup());
  begin perform 1 from public.organization_members limit 1; exception when insufficient_privilege then read_members := 'denied'; end;
  begin perform 1 from public.app_settings limit 1; exception when insufficient_privilege then read_settings := 'denied'; end;
  begin update public.organizations set name = 'x';
  exception when insufficient_privilege then write_org := 'denied'; end;
  begin perform public.join_with_code('BACKUP-25'); exception when insufficient_privilege then call_rpc := 'denied'; end;
  execute 'reset role';
  perform zz.eq('backup role', 'export_backup works', '1', n::text);
  perform zz.eq('backup role', 'cannot read members directly', 'denied', read_members);
  perform zz.eq('backup role', 'cannot read app_settings', 'denied', read_settings);
  perform zz.eq('backup role', 'cannot write', 'denied', write_org);
  perform zz.eq('backup role', 'cannot call app RPCs', 'denied', call_rpc);
end $$;

-- app users cannot run the export
select zz.ok('app roles', 'authenticated cannot run export_backup', zz.att(zz.id('stranger'), 'select public.export_backup()') like '%permission denied%');
select zz.ok('app roles', 'owner cannot run export_backup either', zz.att(zz.id('owner'), 'select public.export_backup()') like '%permission denied%');

-- keep-alive: anon's ping writes one heartbeat row, at most once a minute, and can read nothing
do $$
declare
  first_pings bigint;
  later_pings bigint;
  read_heartbeat text := 'allowed';
begin
  execute 'set local role anon';
  perform public.keepalive();
  begin perform 1 from public.keepalive_heartbeat; exception when insufficient_privilege then read_heartbeat := 'denied'; end;
  execute 'reset role';
  select pings into first_pings from public.keepalive_heartbeat where id = 1;
  update public.keepalive_heartbeat set pinged_at = now() - interval '2 minutes' where id = 1;
  execute 'set local role anon';
  perform public.keepalive();
  perform public.keepalive();
  perform public.keepalive();
  execute 'reset role';
  select pings into later_pings from public.keepalive_heartbeat where id = 1;
  perform zz.ok('keepalive', 'a ping writes the heartbeat row', first_pings >= 1);
  perform zz.eq('keepalive', 'repeated pings within a minute write once', (first_pings + 1)::text, later_pings::text);
  perform zz.eq('keepalive', 'anon cannot read the heartbeat', 'denied', read_heartbeat);
  perform zz.eq('keepalive', 'one heartbeat row only', '1', (select count(*) from public.keepalive_heartbeat)::text);
end $$;
