-- Functional tests for the core flows: setup code, invitation codes, rate limit, roles, audit log, storage.
-- Starts from an empty project (zz.reset_data).
\set ON_ERROR_STOP on
select set_config('zz.suite', '10-schema', false);
select zz.reset_data();

select zz.user('early', '99999999-9999-9999-9999-999999999999', 'early@evil.test');
select zz.user('owner', '11111111-1111-1111-1111-111111111111', 'owner@example.com');
select zz.user('staff', '22222222-2222-2222-2222-222222222222', 'staff@example.com');
select zz.user('wife', '33333333-3333-3333-3333-333333333333', 'wife@example.com');
select zz.user('stranger', '44444444-4444-4444-4444-444444444444', 'stranger@example.com');
select zz.user('racer', '55555555-5555-5555-5555-555555555551', 'racer@example.com');
select zz.user('racer2', '55555555-5555-5555-5555-555555555552', 'racer2@example.com');
select zz.user('guesser', '66666666-6666-6666-6666-666666666666', 'guesser@example.com');

-- 1. Signing up gives no access by itself (an attacker who signs up first gets nothing)
do $$ begin
  perform zz.eq('signup', 'signing up creates no organisation', '0', (select count(*)::text from public.organizations));
  perform zz.eq('signup', 'signing up creates no membership', '0', (select count(*)::text from public.organization_members));
  perform zz.eq('signup', 'ensure_membership without membership -> WB001 + Indonesian message',
    'err:WB001:Akun ini belum menjadi anggota. Masukkan kode dari pemilik laundry.', zz.val(zz.id('early'), 'select public.ensure_membership()'));
  perform zz.chk('signup', 'anon cannot call ensure_membership', '^err:42501', zz.val(null, 'select public.ensure_membership()'));
  perform zz.chk('signup', 'anon cannot call join_with_code', '^err:42501', zz.val(null, 'select public.join_with_code(''ABCDEFGH'')'));
  perform zz.eq('signup', 'join before any setup code exists -> null', 'val:NULL', zz.join(zz.id('early'), 'ABCD-EFGH'));
  perform zz.eq('signup', '... and still no organisation', '0', (select count(*)::text from public.organizations));
end $$;

-- 2. Setup code (operator only)
do $$ begin
  perform zz.chk('setup-code', 'authenticated cannot call set_setup_code', '^err:42501', zz.val(zz.id('owner'), 'select public.set_setup_code(''ABCD-EFGH'')'));
  perform zz.chk('setup-code', 'anon cannot call set_setup_code', '^err:42501', zz.val(null, 'select public.set_setup_code(''ABCD-EFGH'')'));
  perform zz.chk('setup-code', 'authenticated cannot read app_settings', '^err:42501', zz.val(zz.id('owner'), 'select count(*) from public.app_settings'));
  perform zz.chk('setup-code', 'authenticated cannot write app_settings', '^err:42501', zz.att(zz.id('owner'), 'update public.app_settings set setup_code_used_at = null'));
  perform zz.chk('setup-code', 'shorter than 8 after normalising -> refused', 'minimal 8 huruf/angka', zz.su('select public.set_setup_code(''ab-cd 12'')'));
  perform zz.chk('setup-code', 'operator sets the code', '^val:Kode pemilik disimpan', zz.su('select public.set_setup_code('' laun-dry 7k '')', true));
  perform zz.eq('setup-code', 'stored as sha256 hex of the normalised code', encode(sha256(convert_to('LAUNDRY7K', 'UTF8')), 'hex'),
    (select setup_code_hash from public.app_settings));
  perform zz.ok('setup-code', 'setup_code_used_at is empty', (select setup_code_used_at is null from public.app_settings));
  perform zz.eq('setup-code', 'a wrong code -> null', 'val:NULL', zz.join(zz.id('early'), 'LAUN-DRY7X'));
end $$;

-- 3. Two people enter the setup code at the same moment: exactly one becomes the owner
select zz.dbl_open('c1', zz.id('owner'));
select set_config('zz.pid', zz.dbl_open('c2', zz.id('wife'))::text, false);
select zz.dblink_exec('c1', 'begin');
select zz.chk('setup-race', 'first person joins with the setup code (transaction still open)', '^[0-9a-f-]{36}$',
  (select r from zz.dblink('c1', 'select public.join_with_code(''laun-dry7k'')::text') as t(r text)));
select zz.dblink_send_query('c2', 'select public.join_with_code(''LAUNDRY7K'')::text');
select zz.eq('setup-race', 'second person waits for the first (row lock on app_settings)', 'Lock', zz.wait_for_lock(current_setting('zz.pid')::int));
select zz.dblink_exec('c1', 'commit');
select zz.eq('setup-race', 'second person gets null once the first commits', 'NULL',
  (select coalesce(r, 'NULL') from zz.dblink_get_result('c2') as t(r text)));
select * from zz.dblink_get_result('c2') as t(r text);
select zz.dblink_disconnect('c1'), zz.dblink_disconnect('c2');
insert into zz.ids select 'org1', id from public.organizations;
do $$ begin
  perform zz.eq('setup-race', 'exactly one organisation', '1', (select count(*)::text from public.organizations));
  perform zz.eq('setup-race', 'named EG Laundry, created by the owner', 'EG Laundry/' || zz.id('owner'), (select name || '/' || created_by from public.organizations));
  perform zz.eq('setup-race', 'only the owner is a member, with the email of the account', 'owner@example.com:owner',
    (select string_agg(email || ':' || role, ',') from public.organization_members));
  perform zz.ok('setup-race', 'setup code marked used', (select setup_code_used_at is not null from public.app_settings));
  perform zz.eq('setup-race', 'the second person has one failed attempt', '1', (select count(*)::text from public.join_attempts where user_id = zz.id('wife')));
  perform zz.eq('setup-code', 'the setup code cannot be used again', 'val:NULL', zz.join(zz.id('stranger'), 'LAUNDRY7K'));
  perform zz.chk('setup-code', 'operator resets the code once an organisation exists -> warned', 'organisasi sudah ada', zz.su('select public.set_setup_code(''LAUNDRY7K'')', true));
  perform zz.eq('setup-code', '... and it cannot create a second organisation', 'val:NULL', zz.join(zz.id('early'), 'LAUNDRY7K'));
  perform zz.eq('setup-code', 'still one organisation', '1', (select count(*)::text from public.organizations));
  perform zz.eq('setup-code', 'owner: ensure_membership returns the organisation', 'val:' || zz.id('org1'), zz.val(zz.id('owner'), 'select public.ensure_membership()'));
  perform zz.chk('setup-code', 'the early sign-up is still not a member', '^err:WB001', zz.val(zz.id('early'), 'select public.ensure_membership()'));
end $$;

-- 4. Invitation codes
do $$
declare c text;
begin
  c := zz.invite('wife', zz.id('owner'), zz.id('org1'), 'admin', '  Istri  ');
  perform zz.chk('invite', 'code is 8 characters from the alphabet', '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', c);
  perform zz.eq('invite', 'label trimmed, role, invited_by, no email, pending', 'Istri|admin|' || zz.id('owner') || '|-|pending',
    (select label || '|' || role || '|' || invited_by || '|' || coalesce(email, '-') || '|' || coalesce(accepted_at::text, 'pending')
       from public.invitations where org_id = zz.id('org1')));
  perform zz.ok('invite', 'expires in 7 days', (select expires_at between now() + interval '7 days' - interval '1 minute'
                                                   and now() + interval '7 days' + interval '1 minute' from public.invitations));
  perform zz.eq('invite', 'only the sha256 hex of the code is stored', encode(sha256(convert_to(c, 'UTF8')), 'hex'), (select code_hash from public.invitation_codes));
  perform zz.ok('invite', 'the invitation row does not contain the code', not exists (select 1 from public.invitations i where to_jsonb(i)::text like '%' || c || '%'));
  perform zz.chk('invite', 'owner cannot read invitation_codes', '^err:42501', zz.val(zz.id('owner'), 'select count(*) from public.invitation_codes'));
  perform zz.chk('invite', 'create_invitation also returns expires_at (7 days ahead)', '^val:(t|true)$', zz.val(zz.id('owner'), format(
    'select (select expires_at from public.create_invitation(%L, %L, null)) > now() + interval ''6 days''', zz.id('org1'), 'staff')));
  -- typed in lower case with a dash, like the screen shows it
  perform zz.eq('invite', 'join_with_code returns the organisation', 'val:' || zz.id('org1'),
    zz.join(zz.id('wife'), lower(substr(c, 1, 4)) || '-' || lower(substr(c, 5))));
  perform zz.eq('invite', 'wife is admin, with her account email', 'admin|wife@example.com',
    (select role || '|' || email from public.organization_members where user_id = zz.id('wife')));
  perform zz.eq('invite', 'invitation accepted by wife', zz.id('wife')::text, (select accepted_by::text from public.invitations where label = 'Istri' and accepted_at is not null));
  perform zz.eq('invite', 'the same code cannot be used twice', 'val:NULL', zz.join(zz.id('stranger'), c));
  perform zz.chk('invite', 'the stranger is still not a member', '^err:WB001', zz.val(zz.id('stranger'), 'select public.ensure_membership()'));
  -- validation
  perform zz.chk('invite', 'label longer than 60 characters refused', 'maksimal 60 karakter', zz.val(zz.id('owner'),
    format('select code from public.create_invitation(%L, %L, %L)', zz.id('org1'), 'staff', repeat('x', 61))));
  perform zz.chk('invite', 'label of 60 characters accepted', '^val:[A-Z0-9]{8}$', zz.val(zz.id('owner'),
    format('select code from public.create_invitation(%L, %L, %L)', zz.id('org1'), 'staff', '  ' || repeat('x', 60) || '  ')));
  c := zz.invite('blank', zz.id('owner'), zz.id('org1'), 'staff', E' \t\n ');
  perform zz.ok('invite', 'blank label (spaces, tab, newline) stored as null', (select i.label is null from public.invitations i join public.invitation_codes ic on ic.invitation_id = i.id
                                                         where ic.code_hash = encode(sha256(convert_to(c, 'UTF8')), 'hex')));
  perform zz.chk('invite', 'role owner refused', 'Peran tidak valid', zz.val(zz.id('owner'), format('select code from public.create_invitation(%L, %L, null)', zz.id('org1'), 'owner')));
  perform zz.chk('invite', 'role null refused', 'Peran tidak valid', zz.val(zz.id('owner'), format('select code from public.create_invitation(%L, null, null)', zz.id('org1'))));
  perform zz.chk('invite', 'non-member cannot create invitations', 'Hanya pemilik/admin', zz.val(zz.id('stranger'), format('select code from public.create_invitation(%L, %L, null)', zz.id('org1'), 'staff')));
  perform zz.chk('invite', 'anon cannot create invitations', '^err:42501', zz.val(null, format('select code from public.create_invitation(%L, %L, null)', zz.id('org1'), 'staff')));
end $$;

do $$
declare c text;
begin
  c := zz.invite('staff', zz.id('wife'), zz.id('org1'), 'staff', 'Penjaga');
  perform zz.eq('invite', 'admin creates a staff code (invited_by = admin)', zz.id('wife')::text, (select invited_by::text from public.invitations where label = 'Penjaga'));
  perform zz.eq('invite', 'a member entering a code gets the organisation back', 'val:' || zz.id('org1'), zz.join(zz.id('wife'), c));
  perform zz.eq('invite', '... keeps her role', 'admin', (select role from public.organization_members where user_id = zz.id('wife')));
  perform zz.ok('invite', '... and does not use up the code', (select accepted_at is null from public.invitations where label = 'Penjaga'));
  perform zz.eq('invite', 'staff joins with that code', 'val:' || zz.id('org1'), zz.join(zz.id('staff'), c));
  perform zz.eq('invite', 'staff has role staff', 'staff', (select role from public.organization_members where user_id = zz.id('staff')));
  perform zz.chk('invite', 'staff cannot create invitations', 'Hanya pemilik/admin', zz.val(zz.id('staff'), format('select code from public.create_invitation(%L, %L, null)', zz.id('org1'), 'staff')));
  perform zz.eq('invite', 'staff sees no invitations', 'val:0', zz.val(zz.id('staff'), 'select count(*) from public.invitations'));
  perform zz.chk('invite', 'admin sees the invitations', '^val:[1-9]', zz.val(zz.id('wife'), 'select count(*) from public.invitations'));

  c := zz.invite('expired', zz.id('owner'), zz.id('org1'), 'staff', 'Kedaluwarsa');
  update public.invitations set expires_at = now() - interval '1 second' where label = 'Kedaluwarsa';
  perform zz.eq('invite', 'expired code -> null', 'val:NULL', zz.join(zz.id('stranger'), c));

  c := zz.invite('deleted', zz.id('owner'), zz.id('org1'), 'admin', 'Batal');
  perform zz.chk('invite', 'staff cannot delete invitations', '^ok:0$', zz.att(zz.id('staff'), 'delete from public.invitations'));
  perform zz.eq('invite', 'admin deletes an invitation', 'ok:1', zz.att(zz.id('wife'), 'delete from public.invitations where label = ''Batal''', true));
  perform zz.eq('invite', 'its code hash goes with it', '0', (select count(*)::text from public.invitation_codes where code_hash = encode(sha256(convert_to(c, 'UTF8')), 'hex')));
  perform zz.eq('invite', 'deleted code -> null', 'val:NULL', zz.join(zz.id('stranger'), c));
  perform zz.chk('invite', 'admin cannot insert invitations directly', '^err:42501', zz.att(zz.id('wife'),
    format('insert into public.invitations (org_id, role) values (%L, %L)', zz.id('org1'), 'admin')));
  perform zz.chk('invite', 'admin cannot extend an invitation', '^err:42501', zz.att(zz.id('wife'), 'update public.invitations set expires_at = now() + interval ''1 year'''));
end $$;

-- Two people enter the same invitation code at the same moment: one joins, the other gets null
select zz.invite('race', zz.id('owner'), zz.id('org1'), 'staff', 'Rebutan');
select zz.dbl_open('c1', zz.id('racer'));
select set_config('zz.pid', zz.dbl_open('c2', zz.id('racer2'))::text, false);
select zz.dblink_exec('c1', 'begin');
select zz.eq('invite-race', 'first person joins (transaction still open)', zz.id('org1')::text,
  (select r from zz.dblink('c1', format('select public.join_with_code(%L)::text', zz.code('race'))) as t(r text)));
select zz.dblink_send_query('c2', format('select public.join_with_code(%L)::text', zz.code('race')));
select zz.eq('invite-race', 'second person waits on the invitation row lock', 'Lock', zz.wait_for_lock(current_setting('zz.pid')::int));
select zz.dblink_exec('c1', 'commit');
select zz.eq('invite-race', 'second person gets null', 'NULL', (select coalesce(r, 'NULL') from zz.dblink_get_result('c2') as t(r text)));
select * from zz.dblink_get_result('c2') as t(r text);
select zz.dblink_disconnect('c1'), zz.dblink_disconnect('c2');
do $$ begin
  perform zz.eq('invite-race', 'only the first person became a member', 'racer@example.com',
    (select string_agg(email, ',') from public.organization_members where user_id in (zz.id('racer'), zz.id('racer2'))));
  perform zz.eq('invite-race', 'invitation accepted by the first person', zz.id('racer')::text, (select accepted_by::text from public.invitations where label = 'Rebutan'));
end $$;

-- At most 20 active invitations per organisation; used and expired ones do not count
do $$
declare
  active int := (select count(*) from public.invitations where org_id = zz.id('org1') and accepted_at is null and expires_at > now());
  c text;
begin
  for i in active + 1 .. 20 loop
    perform zz.invite('bulk' || i, zz.id('owner'), zz.id('org1'), 'staff', 'Bulk ' || i);
  end loop;
  perform zz.eq('invite-limit', '20 active invitations', '20', (select count(*)::text from public.invitations
    where org_id = zz.id('org1') and accepted_at is null and expires_at > now()));
  perform zz.chk('invite-limit', 'the 21st is refused', 'Sudah ada 20 kode undangan aktif', zz.val(zz.id('owner'),
    format('select code from public.create_invitation(%L, %L, null)', zz.id('org1'), 'staff')));
  perform zz.eq('invite-limit', 'someone uses one of them', 'val:' || zz.id('org1'), zz.join(zz.id('racer2'), zz.code('bulk20')));
  c := zz.invite('after-use', zz.id('owner'), zz.id('org1'), 'staff', 'Setelah dipakai');
  perform zz.chk('invite-limit', 'a used invitation frees a slot', '^[A-Z0-9]{8}$', c);
  update public.invitations set expires_at = now() - interval '1 second' where label = 'Bulk 19';
  c := zz.invite('after-expiry', zz.id('owner'), zz.id('org1'), 'staff', 'Setelah kedaluwarsa');
  perform zz.chk('invite-limit', 'an expired invitation frees a slot', '^[A-Z0-9]{8}$', c);
  delete from public.invitations where label like 'Bulk%' or label like 'Setelah%' or label = 'Rebutan' or label is null;
end $$;

-- Generated codes: alphabet only, all different, evenly spread over the alphabet at every position
do $$
declare
  c text;
  codes text[] := '{}';
begin
  for i in 1..300 loop
    c := zz.invite('gen', zz.id('owner'), zz.id('org1'), 'staff', null);
    codes := codes || c;
    delete from public.invitations i using public.invitation_codes ic
     where ic.invitation_id = i.id and ic.code_hash = encode(sha256(convert_to(c, 'UTF8')), 'hex');
  end loop;
  perform zz.ok('invite-codes', '300 codes, all from the alphabet', (select bool_and(x ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$') from unnest(codes) x));
  perform zz.eq('invite-codes', '300 codes, all different', '300', (select count(distinct x)::text from unnest(codes) x));
  perform zz.ok('invite-codes', 'no look-alike characters (0 O 1 I L)', not exists (select 1 from unnest(codes) x where x ~ '[0O1IL]'));
  perform zz.eq('invite-codes', 'all 31 characters are used', '31', (select count(distinct ch)::text from unnest(codes) x, regexp_split_to_table(x, '') ch));
  -- uniform: about 15/31 of the codes have a character from the second half of the alphabet at each
  -- position (expected 145 of 300; outside 105..185 is > 4.5 standard deviations away)
  perform zz.eq('invite-codes', 'every position is uniform (no UUID version/variant bits)', '',
    (select coalesce(string_agg(format('position %s: %s', pos, n), '; '), '') from (
       select pos, count(*) filter (where strpos('ABCDEFGHJKMNPQRSTUVWXYZ23456789', substr(x, pos, 1)) > 16) as n
       from unnest(codes) x, generate_series(1, 8) pos group by pos) s
     where n not between 105 and 185));
end $$;

-- 5. Rate limit: 10 failures per hour per account
do $$
declare
  c text;
  r text;
begin
  foreach r in array array['', 'AB', 'ABCDEFG', 'ZZZZ-ZZZZ', '22222222', 'XXXXXXXX', 'YYYYYYYY', 'KKKKKKKK', 'MMMMMMMM', 'NNNNNNNN'] loop
    perform zz.eq('rate-limit', format('wrong code %L -> null', r), 'val:NULL', zz.join(zz.id('guesser'), r));
  end loop;
  perform zz.eq('rate-limit', 'every failure is recorded (empty and short codes too)', '10',
    (select count(*)::text from public.join_attempts where user_id = zz.id('guesser')));
  c := zz.invite('rl', zz.id('owner'), zz.id('org1'), 'staff', 'Batas percobaan');
  perform zz.eq('rate-limit', 'the 11th attempt is refused, even with a valid code', 'err:P0001:Terlalu banyak percobaan. Coba lagi dalam 1 jam.',
    zz.join(zz.id('guesser'), c));
  perform zz.eq('rate-limit', '... not a member', '0', (select count(*)::text from public.organization_members where user_id = zz.id('guesser')));
  perform zz.ok('rate-limit', '... and the code is still unused', (select accepted_at is null from public.invitations where label = 'Batas percobaan'));
  perform zz.eq('rate-limit', 'other accounts are not affected', 'val:NULL', zz.join(zz.id('early'), 'QQQQ-QQQQ'));
  perform zz.eq('rate-limit', 'a null code counts as a failure', 'val:NULL', zz.val(zz.id('early'), 'select public.join_with_code(null)', true));
  perform zz.chk('rate-limit', 'a user cannot clear own attempts', '^err:42501', zz.att(zz.id('guesser'), 'delete from public.join_attempts'));
  perform zz.chk('rate-limit', 'a user cannot read attempts', '^err:42501', zz.val(zz.id('guesser'), 'select count(*) from public.join_attempts'));
  perform zz.chk('rate-limit', 'a user cannot add attempts for someone else', '^err:42501', zz.att(zz.id('guesser'),
    format('insert into public.join_attempts (user_id) values (%L)', zz.id('owner'))));
  update public.join_attempts set attempted_at = attempted_at - interval '61 minutes' where user_id = zz.id('guesser');
  perform zz.eq('rate-limit', 'an hour later the valid code works', 'val:' || zz.id('org1'), zz.join(zz.id('guesser'), c));
end $$;

-- One account's attempts are checked one at a time, so parallel requests cannot get past the limit
select zz.user('burst', '66666666-6666-6666-6666-666666666601', 'burst@example.com');
select zz.user('burst2', '66666666-6666-6666-6666-666666666602', 'burst2@example.com');
insert into public.join_attempts (user_id) select zz.id('burst') from generate_series(1, 9);
select zz.dbl_open('c1', zz.id('burst'));
select set_config('zz.pid', zz.dbl_open('c2', zz.id('burst'))::text, false);
select zz.dblink_exec('c1', 'begin');
select zz.eq('rate-limit-race', '10th wrong code (transaction still open)', 'NULL',
  (select coalesce(r, 'NULL') from zz.dblink('c1', 'select public.join_with_code(''WRONG-0010'')::text') as t(r text)));
select zz.dblink_send_query('c2', 'select public.join_with_code(''WRONG-0011'')::text');
select zz.eq('rate-limit-race', 'a parallel attempt by the same account waits for it', 'Lock', zz.wait_for_lock(current_setting('zz.pid')::int));
select zz.dblink_exec('c1', 'commit');
select zz.eq('rate-limit-race', '... and is refused once the first commits', '0', (select count(*)::text from zz.dblink_get_result('c2', false) as t(r text)));
select zz.chk('rate-limit-race', '... with the rate-limit message', 'Terlalu banyak percobaan', zz.dblink_error_message('c2'));
select * from zz.dblink_get_result('c2', false) as t(r text);
select zz.dblink_disconnect('c1'), zz.dblink_disconnect('c2');
select zz.eq('rate-limit-race', 'exactly 10 failures recorded', '10', (select count(*)::text from public.join_attempts where user_id = zz.id('burst')));
do $$
declare answered int := 0;
begin
  for i in 1..20 loop
    perform zz.dbl_open('burst' || i, zz.id('burst2'));
  end loop;
  for i in 1..20 loop
    perform zz.dblink_send_query('burst' || i, format('select public.join_with_code(%L)::text', 'WRONG' || lpad(i::text, 3, '0')));
  end loop;
  for i in 1..20 loop
    answered := answered + (select count(*) from zz.dblink_get_result('burst' || i, false) as t(r text));
    perform * from zz.dblink_get_result('burst' || i, false) as t(r text);
    perform zz.dblink_disconnect('burst' || i);
  end loop;
  perform zz.eq('rate-limit-race', '20 wrong codes sent at once: 10 answered, the rest refused', '10', answered::text);
  perform zz.eq('rate-limit-race', '... and 10 failures recorded', '10', (select count(*)::text from public.join_attempts where user_id = zz.id('burst2')));
end $$;

-- 6. Roles (owner only) and removing members
do $$
declare
  org text := zz.id('org1');
  q text := 'select public.set_member_role(%L, %L, %L)';
begin
  perform zz.chk('roles', 'admin cannot change roles', 'Hanya pemilik yang dapat mengubah peran', zz.att(zz.id('wife'), format(q, org, zz.id('staff'), 'admin')));
  perform zz.chk('roles', 'staff cannot promote self', 'Hanya pemilik', zz.att(zz.id('staff'), format(q, org, zz.id('staff'), 'owner')));
  perform zz.chk('roles', 'non-member cannot change roles', 'Hanya pemilik', zz.att(zz.id('stranger'), format(q, org, zz.id('stranger'), 'owner')));
  perform zz.chk('roles', 'anon cannot call set_member_role', '^err:42501', zz.att(null, format(q, org, zz.id('staff'), 'owner')));
  perform zz.chk('roles', 'invalid role refused', 'Peran tidak valid', zz.att(zz.id('owner'), format(q, org, zz.id('staff'), 'boss')));
  perform zz.chk('roles', 'unknown member refused', 'Anggota tidak ditemukan', zz.att(zz.id('owner'), format(q, org, zz.id('stranger'), 'admin')));
  perform zz.eq('roles', 'sole owner cannot step down', 'err:P0001:Tidak dapat mengubah peran pemilik terakhir.', zz.att(zz.id('owner'), format(q, org, zz.id('owner'), 'admin')));
  perform zz.eq('roles', 'owner promotes staff to admin', 'ok:1', zz.att(zz.id('owner'), format(q, org, zz.id('racer'), 'admin'), true));
  perform zz.eq('roles', '... role is admin', 'admin', (select role from public.organization_members where user_id = zz.id('racer')));
  perform zz.eq('roles', 'owner demotes admin to staff', 'ok:1', zz.att(zz.id('owner'), format(q, org, zz.id('racer'), 'staff'), true));
  perform zz.eq('roles', '... role is staff', 'staff', (select role from public.organization_members where user_id = zz.id('racer')));
  perform zz.eq('roles', 'owner makes wife a second owner', 'ok:1', zz.att(zz.id('owner'), format(q, org, zz.id('wife'), 'owner'), true));
  perform zz.eq('roles', 'with two owners, an owner may step down', 'ok:1', zz.att(zz.id('owner'), format(q, org, zz.id('owner'), 'admin'), true));
  perform zz.chk('roles', 'the remaining owner cannot step down', 'pemilik terakhir', zz.att(zz.id('wife'), format(q, org, zz.id('wife'), 'staff')));
  perform zz.chk('roles', 'the former owner (now admin) cannot take it back', 'Hanya pemilik', zz.att(zz.id('owner'), format(q, org, zz.id('owner'), 'owner')));
  perform zz.eq('roles', 'wife gives ownership back', 'ok:1', zz.att(zz.id('wife'), format(q, org, zz.id('owner'), 'owner'), true));
  perform zz.eq('roles', 'owner ensure_membership still prefers the owned organisation', 'val:' || org, zz.val(zz.id('owner'), 'select public.ensure_membership()'));
  perform zz.chk('roles', 'direct UPDATE of organization_members refused', '^err:42501', zz.att(zz.id('owner'), 'update public.organization_members set role = ''owner'''));
  perform zz.chk('roles', 'direct INSERT into organization_members refused', '^err:42501', zz.att(zz.id('owner'),
    format('insert into public.organization_members (org_id, user_id, role) values (%L, %L, %L)', org, zz.id('stranger'), 'owner')));
  perform zz.chk('roles', 'direct DELETE from organization_members refused', '^err:42501', zz.att(zz.id('owner'), 'delete from public.organization_members'));

  -- owners: owner + wife; admin: racer (below); staff: staff, racer2, guesser
  perform zz.att(zz.id('owner'), format(q, org, zz.id('racer'), 'admin'), true);
  perform zz.att(zz.id('owner'), format(q, org, zz.id('guesser'), 'admin'), true);
  q := 'select public.remove_member(%L, %L)';
  perform zz.chk('remove', 'owner cannot remove self', 'diri sendiri', zz.att(zz.id('owner'), format(q, org, zz.id('owner'))));
  perform zz.chk('remove', 'staff cannot remove members', 'Hanya pemilik/admin', zz.att(zz.id('staff'), format(q, org, zz.id('racer2'))));
  perform zz.chk('remove', 'non-member cannot remove members', 'Hanya pemilik/admin', zz.att(zz.id('stranger'), format(q, org, zz.id('staff'))));
  perform zz.chk('remove', 'admin cannot remove an owner', 'Hanya pemilik yang dapat menghapus pemilik lain', zz.att(zz.id('racer'), format(q, org, zz.id('wife'))));
  perform zz.chk('remove', 'admin cannot remove another admin', 'Hanya pemilik yang dapat menghapus admin', zz.att(zz.id('racer'), format(q, org, zz.id('guesser'))));
  perform zz.eq('remove', 'with two owners, an owner may remove the other', 'ok:1', zz.att(zz.id('owner'), format(q, org, zz.id('wife'))));
  perform zz.eq('remove', 'admin removes staff', 'ok:1', zz.att(zz.id('racer'), format(q, org, zz.id('racer2')), true));
  perform zz.eq('remove', '... gone', '0', (select count(*)::text from public.organization_members where user_id = zz.id('racer2')));
  perform zz.eq('remove', 'owner removes an admin', 'ok:1', zz.att(zz.id('owner'), format(q, org, zz.id('guesser')), true));
  perform zz.eq('roles', 'wife back to admin', 'ok:1', zz.att(zz.id('owner'), format('select public.set_member_role(%L, %L, %L)', org, zz.id('wife'), 'admin'), true));
  perform zz.eq('roles', 'members now', 'owner:owner,racer:admin,staff:staff,wife:admin',
    (select string_agg(split_part(email, '@', 1) || ':' || role, ',' order by email) from public.organization_members));
end $$;

-- Two owners demote each other at the same moment: the organisation keeps an owner
select zz.att(zz.id('owner'), format('select public.set_member_role(%L, %L, %L)', zz.id('org1'), zz.id('wife'), 'owner'), true);
select zz.dbl_open('c1', zz.id('owner'));
select set_config('zz.pid', zz.dbl_open('c2', zz.id('wife'))::text, false);
select zz.dblink_exec('c1', 'begin');
select * from zz.dblink('c1', format('select public.set_member_role(%L, %L, %L)::text', zz.id('org1'), zz.id('wife'), 'admin')) as t(r text);
select zz.dblink_send_query('c2', format('select public.set_member_role(%L, %L, %L)::text', zz.id('org1'), zz.id('owner'), 'admin'));
select zz.eq('roles-race', 'second owner waits for the first (organisation row lock)', 'Lock', zz.wait_for_lock(current_setting('zz.pid')::int));
select zz.dblink_exec('c1', 'commit');
select zz.eq('roles-race', 'second owner is refused once the first has committed', '0', (select count(*)::text from zz.dblink_get_result('c2', false) as t(r text)));
select zz.chk('roles-race', '... she is no longer an owner', 'Hanya pemilik yang dapat mengubah peran', zz.dblink_error_message('c2'));
select * from zz.dblink_get_result('c2', false) as t(r text);
select zz.dblink_disconnect('c1'), zz.dblink_disconnect('c2');
select zz.eq('roles-race', 'the first change won, one owner left', 'owner@example.com:owner,wife@example.com:admin',
  (select string_agg(email || ':' || role, ',' order by email) from public.organization_members where user_id in (zz.id('owner'), zz.id('wife'))));

-- Codes stop working once whoever made them can no longer invite (removed, or demoted to staff)
select zz.user('rejoin', '77777777-7777-7777-7777-777777777771', 'rejoin@example.com');
do $$
declare
  org uuid := zz.id('org1');
  r uuid := zz.id('racer');
  q text := 'select public.set_member_role(%L, %L, %L)';
begin
  perform zz.invite('dm-admin', r, org, 'admin', 'Dari admin');
  perform zz.eq('revoke-codes', 'owner demotes an admin to staff', 'ok:1', zz.att(zz.id('owner'), format(q, org, r, 'staff'), true));
  perform zz.eq('revoke-codes', '... the codes she made are expired', '0', (select count(*)::text from public.invitations
    where invited_by = r and accepted_at is null and expires_at > now()));
  perform zz.eq('revoke-codes', '... her admin code no longer works', 'val:NULL', zz.join(zz.id('rejoin'), zz.code('dm-admin')));
  perform zz.eq('revoke-codes', 'promoted to admin again', 'ok:1', zz.att(zz.id('owner'), format(q, org, r, 'admin'), true));
  perform zz.eq('revoke-codes', '... the old code stays expired', 'val:NULL', zz.join(zz.id('rejoin'), zz.code('dm-admin')));

  perform zz.invite('rm-admin', r, org, 'admin', 'Sebelum dihapus');
  perform zz.invite('rm-staff', r, org, 'staff', 'Sebelum dihapus 2');
  perform zz.eq('revoke-codes', 'owner removes the admin', 'ok:1', zz.att(zz.id('owner'), format('select public.remove_member(%L, %L)', org, r), true));
  perform zz.eq('revoke-codes', '... the codes she made are expired', '0', (select count(*)::text from public.invitations
    where invited_by = r and accepted_at is null and expires_at > now()));
  perform zz.eq('revoke-codes', 'she cannot re-join with her own admin code', 'val:NULL', zz.join(r, zz.code('rm-admin')));
  perform zz.chk('revoke-codes', '... and is still not a member', '^err:WB001', zz.val(r, 'select public.ensure_membership()'));
  perform zz.eq('revoke-codes', 'a second account cannot join with her code either', 'val:NULL', zz.join(zz.id('rejoin'), zz.code('rm-staff')));
  -- even an unexpired code (say, extended by the operator) only works while its maker may invite
  update public.invitations set expires_at = now() + interval '1 day' where invited_by = r and accepted_at is null;
  perform zz.eq('revoke-codes', 'unexpired admin code from a removed admin -> null', 'val:NULL', zz.join(zz.id('rejoin'), zz.code('rm-admin')));
  perform zz.eq('revoke-codes', 'unexpired code, same account re-joining -> null', 'val:NULL', zz.join(r, zz.code('rm-staff')));
  perform zz.eq('revoke-codes', '... neither became a member', '0', (select count(*)::text from public.organization_members where user_id in (r, zz.id('rejoin'))));
  -- the maker's account was deleted (invited_by is cleared)
  perform zz.invite('orphan', zz.id('wife'), org, 'staff', 'Akun dihapus');
  update public.invitations set invited_by = null where label = 'Akun dihapus';
  perform zz.eq('revoke-codes', 'code whose maker no longer exists -> null', 'val:NULL', zz.join(zz.id('rejoin'), zz.code('orphan')));
  perform zz.invite('still-ok', zz.id('wife'), org, 'staff', 'Masih berlaku');
  perform zz.eq('revoke-codes', 'a code from an admin who is still there works', 'val:' || org, zz.join(zz.id('rejoin'), zz.code('still-ok')));
  perform zz.eq('revoke-codes', 'clean up', 'ok:1', zz.att(zz.id('owner'), format('select public.remove_member(%L, %L)', org, zz.id('rejoin')), true));
  delete from public.invitations where label in ('Dari admin', 'Sebelum dihapus', 'Sebelum dihapus 2', 'Akun dihapus', 'Masih berlaku');
end $$;

-- An admin is removed while someone is entering her code: whoever commits second loses
select zz.user('rejoin2', '77777777-7777-7777-7777-777777777772', 'rejoin2@example.com');
select zz.user('admin2', '77777777-7777-7777-7777-777777777773', 'admin2@example.com');
select zz.join(zz.id('admin2'), zz.invite('admin2', zz.id('owner'), zz.id('org1'), 'admin', 'Admin 2'));
select zz.invite('race-rm', zz.id('admin2'), zz.id('org1'), 'staff', 'Rebutan hapus');
select zz.dbl_open('c1', zz.id('owner'));
select set_config('zz.pid', zz.dbl_open('c2', zz.id('rejoin2'))::text, false);
-- the join's transaction starts first, so its now() is earlier than the removal's
select zz.dblink_exec('c2', 'begin');
select pg_sleep(0.01);
select zz.dblink_exec('c1', 'begin');
select * from zz.dblink('c1', format('select public.remove_member(%L, %L)::text', zz.id('org1'), zz.id('admin2'))) as t(r text);
select zz.dblink_send_query('c2', format('select public.join_with_code(%L)::text', zz.code('race-rm')));
select zz.eq('revoke-race', 'the join waits for the removal', 'Lock', zz.wait_for_lock(current_setting('zz.pid')::int));
select zz.dblink_exec('c1', 'commit');
select zz.eq('revoke-race', '... and gets null once the removal commits', 'NULL', (select coalesce(r, 'NULL') from zz.dblink_get_result('c2') as t(r text)));
select * from zz.dblink_get_result('c2') as t(r text);
select zz.dblink_exec('c2', 'commit');
select zz.dblink_disconnect('c1'), zz.dblink_disconnect('c2');
select zz.eq('revoke-race', 'neither the removed admin nor the new account is a member', '0',
  (select count(*)::text from public.organization_members where user_id in (zz.id('admin2'), zz.id('rejoin2'))));
delete from public.invitations where label in ('Admin 2', 'Rebutan hapus');


-- 7. Audit log
do $$
declare
  n bigint;
  org uuid := zz.id('org1');
begin
  perform zz.ok('audit', 'organisation creation logged with its creator', exists (select 1 from public.audit_log
    where table_name = 'organizations' and action = 'insert' and org_id = org and changed_by = zz.id('owner')));
  perform zz.ok('audit', 'joining by code logged (member row + accepted invitation)', exists (select 1 from public.audit_log
    where table_name = 'organization_members' and action = 'insert' and changed_by = zz.id('staff') and new_data ->> 'role' = 'staff')
    and exists (select 1 from public.audit_log where table_name = 'invitations' and action = 'update' and changed_by = zz.id('staff')
      and old_data ->> 'accepted_at' is null and new_data ->> 'accepted_by' = zz.id('staff')::text));
  perform zz.ok('audit', 'role change logged', exists (select 1 from public.audit_log where table_name = 'organization_members' and action = 'update'
    and changed_by = zz.id('owner') and old_data ->> 'role' = 'staff' and new_data ->> 'role' = 'admin'));
  perform zz.ok('audit', 'removed member logged', exists (select 1 from public.audit_log where table_name = 'organization_members' and action = 'delete'
    and old_data ->> 'user_id' = zz.id('racer2')::text and new_data is null));
  perform zz.eq('audit', 'owner renames the laundry', 'ok:1', zz.att(zz.id('owner'), format('update public.organizations set name = %L where id = %L', 'EG Laundry Pusat', org), true));
  perform zz.ok('audit', 'rename logged with old and new name', exists (select 1 from public.audit_log where table_name = 'organizations' and action = 'update'
    and row_id = org and changed_by = zz.id('owner') and old_data ->> 'name' = 'EG Laundry' and new_data ->> 'name' = 'EG Laundry Pusat'));
  perform zz.eq('audit', 'staff cannot rename the laundry', 'ok:0', zz.att(zz.id('staff'), format('update public.organizations set name = %L where id = %L', 'Milik Staf', org)));
  perform zz.ok('audit', 'refused changes leave no trace', not exists (select 1 from public.audit_log where new_data ->> 'name' = 'Milik Staf'));
  perform zz.ok('audit', 'invitation code hashes never reach the log', not exists (select 1 from public.audit_log a, public.invitation_codes c
    where a.old_data::text like '%' || c.code_hash || '%' or a.new_data::text like '%' || c.code_hash || '%'));
  n := (select count(*) from public.audit_log);
  perform zz.eq('audit', 'an update that changes nothing', 'ok:1', zz.att(zz.id('owner'), format('update public.organizations set name = name where id = %L', org), true));
  perform zz.eq('audit', '... is not logged', n::text, (select count(*)::text from public.audit_log));
  -- who reads it
  perform zz.chk('audit', 'owner reads the history', '^val:[1-9]', zz.val(zz.id('owner'), 'select count(*) from public.audit_log'));
  perform zz.chk('audit', 'admin reads the history', '^val:[1-9]', zz.val(zz.id('wife'), 'select count(*) from public.audit_log'));
  perform zz.eq('audit', 'staff sees no history', 'val:0', zz.val(zz.id('staff'), 'select count(*) from public.audit_log'));
  perform zz.eq('audit', 'non-member sees no history', 'val:0', zz.val(zz.id('stranger'), 'select count(*) from public.audit_log'));
  perform zz.chk('audit', 'anon cannot read the history', '^err:42501', zz.val(null, 'select count(*) from public.audit_log'));
  -- nobody changes it
  perform zz.chk('audit', 'owner cannot delete history', '^err:42501', zz.att(zz.id('owner'), 'delete from public.audit_log'));
  perform zz.chk('audit', 'owner cannot edit history', '^err:42501', zz.att(zz.id('owner'), 'update public.audit_log set old_data = null'));
  perform zz.chk('audit', 'owner cannot truncate history', '^err:42501', zz.att(zz.id('owner'), 'truncate public.audit_log'));
  perform zz.chk('audit', 'owner cannot forge history', '^err:42501', zz.att(zz.id('owner'),
    format('insert into public.audit_log (org_id, table_name, action) values (%L, %L, %L)', org, 'organizations', 'delete')));
  perform zz.chk('audit', 'the trigger function cannot be called directly', '^err:', zz.att(zz.id('owner'), 'select public.audit_row_change()'));
end $$;

-- the operator deletes a whole organisation: rows and history go, nothing fails on the way
do $$
declare
  x uuid := '99999999-0000-0000-0000-00000000000a';
begin
  insert into public.organizations (id, name) values (x, 'Dihapus');
  insert into public.organization_members (org_id, user_id, role) values (x, zz.id('stranger'), 'owner');
  insert into public.invitations (org_id, role) values (x, 'staff');
  perform zz.ok('audit', '... with their history', (select count(*) >= 3 from public.audit_log where org_id = x));
  perform zz.eq('audit', 'operator deletes the whole organisation', 'val:1', zz.su(format('with d as (delete from public.organizations where id = %L returning 1) select count(*) from d', x), true));
  perform zz.eq('audit', 'its history went with it', '0', (select count(*)::text from public.audit_log where org_id = x));
  perform zz.eq('audit', 'its rows went with it', '0', (select count(*)::text from public.organization_members where org_id = x));
end $$;

-- 8. Storage: the laundry logo lives in the org folder of the private logos bucket
do $$
declare
  org uuid := zz.id('org1');
begin
  perform zz.ok('storage', 'bad path -> no organisation', public.path_org_id('not-a-uuid/file.jpg') is null);
  perform zz.eq('storage', 'path org id', org::text, public.path_org_id(org || '/logo.png')::text);
  perform zz.eq('storage', 'logos bucket: private, 1 MB, png/jpeg/webp', 'false:1048576:image/png,image/jpeg,image/webp',
    (select public::text || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'logos'));
  perform zz.eq('storage', 'owner uploads the logo', 'ok:1', zz.att(zz.id('owner'), format('insert into storage.objects (bucket_id, name) values (%L, %L)',
    'logos', org || '/logo.png'), true));
  perform zz.eq('storage', 'staff reads the logo (signed URL needs select)', 'val:1', zz.val(zz.id('staff'), format('select count(*) from storage.objects where bucket_id = %L and name = %L',
    'logos', org || '/logo.png')));
  perform zz.chk('storage', 'staff cannot upload a logo (admin only)', '^err:42501', zz.att(zz.id('staff'), format('insert into storage.objects (bucket_id, name) values (%L, %L)',
    'logos', org || '/staff.png')));
  perform zz.eq('storage', 'staff cannot delete the logo', 'ok:0', zz.att(zz.id('staff'), format('delete from storage.objects where bucket_id = %L and name = %L',
    'logos', org || '/logo.png')));
  perform zz.eq('storage', 'stranger cannot read the logo', 'val:0', zz.val(zz.id('stranger'), 'select count(*) from storage.objects where bucket_id = ''logos'''));
  perform zz.chk('storage', 'stranger cannot upload into the org folder', '^err:42501', zz.att(zz.id('stranger'), format('insert into storage.objects (bucket_id, name) values (%L, %L)',
    'logos', org || '/evil.png')));
  perform zz.chk('storage', 'anon cannot upload a logo', '^err:42501', zz.att(null, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'logos', org || '/anon.png')));
  perform zz.eq('storage', 'owner removes the logo (Storage API)', 'ok:1', zz.att(zz.id('owner'), format('delete from storage.objects where bucket_id = %L and name = %L',
    'logos', org || '/logo.png'), true));
end $$;

-- 9. Structure and privileges
select zz.check_structure('structure');
