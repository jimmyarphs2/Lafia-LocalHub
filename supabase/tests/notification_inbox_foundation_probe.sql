-- Rollback-only hosted regression probe for migration 035. This verifies the
-- in-app inbox contract and proves that external delivery remains dormant.
-- This is necessarily a one-session probe. Realtime publication authorization
-- and row visibility must additionally be checked from a second authenticated
-- client session after migration, with an owner subscription and a foreign or
-- suspended-profile negative case; do not add fixture notifications outside
-- this rollback transaction merely to exercise that operational check.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local transaction_timeout = '180s';

lock table public.notifications, private.notification_deliveries
  in access exclusive mode;

do $$
declare
  actual_columns text[];
  actual_indexes text[];
  function_record pg_catalog.pg_proc%rowtype;
  privilege_name text;
  role_name text;
begin
  select pg_catalog.array_agg(attribute_record.attname order by attribute_record.attnum)
  into actual_columns
  from pg_catalog.pg_attribute attribute_record
  where attribute_record.attrelid = 'public.notifications'::pg_catalog.regclass
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped;

  if actual_columns is distinct from array[
    'id',
    'profile_id',
    'template_key',
    'read_at',
    'created_at',
    'market_id',
    'source_kind',
    'source_id',
    'template_version',
    'title',
    'body',
    'action_path'
  ]::text[] then
    raise exception 'notification column contract drifted';
  end if;

  select pg_catalog.array_agg(index_record.relname order by index_record.relname)
  into actual_indexes
  from pg_catalog.pg_index definition_record
  join pg_catalog.pg_class index_record
    on index_record.oid = definition_record.indexrelid
  where definition_record.indrelid = 'public.notifications'::pg_catalog.regclass;

  if actual_indexes is distinct from array[
    'notifications_market_id_fkey_idx',
    'notifications_pkey',
    'notifications_profile_created_id_idx',
    'notifications_profile_unread_created_id_idx',
    'notifications_recipient_source_template_unique'
  ]::text[] then
    raise exception 'notification index contract drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.notifications'::pg_catalog.regclass
      and constraint_record.conname = 'notifications_profile_id_fkey'
      and constraint_record.confrelid = 'public.profiles'::pg_catalog.regclass
      and constraint_record.confdeltype = 'c'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.notifications'::pg_catalog.regclass
      and constraint_record.conname = 'notifications_market_id_fkey'
      and constraint_record.confrelid = 'public.markets'::pg_catalog.regclass
      and constraint_record.confdeltype = 'r'
  ) then
    raise exception 'notification foreign-key contract drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation_record
    where relation_record.oid = 'public.notifications'::pg_catalog.regclass
      and relation_record.relrowsecurity
      and relation_record.relforcerowsecurity
      and relation_record.relreplident <> 'f'
      and pg_catalog.pg_get_userbyid(relation_record.relowner) = 'postgres'
  ) or (
    select count(*)
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'notifications'
  ) <> 1 or not exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'notifications'
      and policy_record.policyname = 'notifications_active_self_select'
      and policy_record.cmd = 'SELECT'
      and policy_record.roles = array['authenticated']::name[]
  ) then
    raise exception 'notification RLS contract drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables publication_record
    where publication_record.pubname = 'supabase_realtime'
      and publication_record.schemaname = 'public'
      and publication_record.tablename = 'notifications'
  ) or exists (
    select 1
    from pg_catalog.pg_publication_tables publication_record
    where publication_record.schemaname = 'private'
      and publication_record.tablename = 'notification_deliveries'
  ) then
    raise exception 'notification publication scope drifted';
  end if;

  if pg_catalog.has_table_privilege(
    'authenticated', 'public.notifications', 'select'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.notifications', 'insert'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.notifications', 'update'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.notifications', 'delete'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.notifications', 'truncate'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.notifications', 'references'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.notifications', 'trigger'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.notifications', 'maintain'
  ) or not pg_catalog.has_any_column_privilege(
    'authenticated', 'public.notifications', 'select'
  ) or pg_catalog.has_any_column_privilege(
    'authenticated', 'public.notifications', 'update'
  ) or pg_catalog.has_column_privilege(
    'authenticated', 'public.notifications', 'source_kind', 'select'
  ) or pg_catalog.has_column_privilege(
    'authenticated', 'public.notifications', 'source_id', 'select'
  ) then
    raise exception 'notification authenticated ACL drifted';
  end if;

  foreach role_name in array array['anon', 'service_role'] loop
    foreach privilege_name in array array[
      'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger',
      'maintain'
    ] loop
      if pg_catalog.has_table_privilege(
        role_name, 'public.notifications', privilege_name
      ) then
        raise exception '% retained notification table %', role_name, privilege_name;
      end if;
    end loop;
    foreach privilege_name in array array['select', 'insert', 'update', 'references'] loop
      if pg_catalog.has_any_column_privilege(
        role_name, 'public.notifications', privilege_name
      ) then
        raise exception '% retained notification column %', role_name, privilege_name;
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_class relation_record
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation_record.relacl,
        pg_catalog.acldefault('r', relation_record.relowner)
      )
    ) privilege_record
    where relation_record.oid in (
      'public.notifications'::pg_catalog.regclass,
      'private.notification_deliveries'::pg_catalog.regclass
    )
      and privilege_record.grantee = 0
  ) or exists (
    select 1
    from pg_catalog.pg_attribute attribute_record
    cross join lateral pg_catalog.aclexplode(attribute_record.attacl)
      privilege_record
    where attribute_record.attrelid in (
      'public.notifications'::pg_catalog.regclass,
      'private.notification_deliveries'::pg_catalog.regclass
    )
      and attribute_record.attnum > 0
      and not attribute_record.attisdropped
      and privilege_record.grantee = 0
  ) then
    raise exception 'PUBLIC retained notification access';
  end if;

  foreach privilege_name in array array[
    'public.list_my_notifications(integer,timestamp with time zone,uuid,boolean)',
    'public.mark_my_notification_read(uuid)'
  ] loop
    select routine_record.*
    into strict function_record
    from pg_catalog.pg_proc routine_record
    where routine_record.oid = privilege_name::pg_catalog.regprocedure;

    if pg_catalog.pg_get_userbyid(function_record.proowner) <> 'postgres'
      or not coalesce(function_record.proconfig, array[]::text[])
        @> array['search_path=""']::text[]
      or not pg_catalog.has_function_privilege(
        'authenticated', privilege_name, 'execute'
      )
      or pg_catalog.has_function_privilege('anon', privilege_name, 'execute')
      or pg_catalog.has_function_privilege('service_role', privilege_name, 'execute')
      or exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(
            function_record.proacl,
            pg_catalog.acldefault('f', function_record.proowner)
          )
        ) acl_record
        where acl_record.grantee = 0
          and acl_record.privilege_type = 'EXECUTE'
      )
    then
      raise exception 'notification RPC ACL or owner drifted';
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_proc routine_record
    where routine_record.oid =
      'public.list_my_notifications(integer,timestamp with time zone,uuid,boolean)'::pg_catalog.regprocedure
      and not routine_record.prosecdef
      and routine_record.provolatile = 's'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc routine_record
    where routine_record.oid =
      'public.mark_my_notification_read(uuid)'::pg_catalog.regprocedure
      and routine_record.prosecdef
      and routine_record.provolatile = 'v'
  ) then
    raise exception 'notification RPC execution mode drifted';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.notifications'::pg_catalog.regclass
      and trigger_record.tgfoid =
        'private.enforce_notification_read_state()'::pg_catalog.regprocedure
      and trigger_record.tgenabled = 'A'
      and not trigger_record.tgisinternal
  ) <> 1 then
    raise exception 'notification read-state trigger drifted';
  end if;
end;
$$;

do $$
declare
  actual_columns text[];
  actual_indexes text[];
  privilege_name text;
  role_name text;
begin
  select pg_catalog.array_agg(attribute_record.attname order by attribute_record.attnum)
  into actual_columns
  from pg_catalog.pg_attribute attribute_record
  where attribute_record.attrelid =
    'private.notification_deliveries'::pg_catalog.regclass
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped;

  if actual_columns is distinct from array[
    'id',
    'notification_id',
    'channel',
    'status',
    'idempotency_key_sha256',
    'attempt_count',
    'available_at',
    'lease_token',
    'leased_at',
    'lease_expires_at',
    'last_attempt_at',
    'provider_code',
    'provider_message_id',
    'last_error_code',
    'completed_at',
    'created_at',
    'updated_at'
  ]::text[] then
    raise exception 'delivery column contract drifted';
  end if;

  select pg_catalog.array_agg(index_record.relname order by index_record.relname)
  into actual_indexes
  from pg_catalog.pg_index definition_record
  join pg_catalog.pg_class index_record
    on index_record.oid = definition_record.indexrelid
  where definition_record.indrelid =
    'private.notification_deliveries'::pg_catalog.regclass;

  if actual_indexes is distinct from array[
    'notification_deliveries_expired_lease_idx',
    'notification_deliveries_idempotency_key_sha256_key',
    'notification_deliveries_notification_channel_unique',
    'notification_deliveries_pkey',
    'notification_deliveries_provider_message_unique_idx',
    'notification_deliveries_ready_idx'
  ]::text[] then
    raise exception 'delivery index contract drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
      'private.notification_deliveries'::pg_catalog.regclass
      and constraint_record.conname = 'notification_deliveries_notification_id_fkey'
      and constraint_record.confrelid = 'public.notifications'::pg_catalog.regclass
      and constraint_record.confdeltype = 'c'
  ) or not exists (
    select 1
    from pg_catalog.pg_class relation_record
    where relation_record.oid =
      'private.notification_deliveries'::pg_catalog.regclass
      and relation_record.relrowsecurity
      and relation_record.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation_record.relowner) = 'postgres'
  ) or exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'private'
      and policy_record.tablename = 'notification_deliveries'
  ) then
    raise exception 'delivery FK or RLS contract drifted';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    foreach privilege_name in array array[
      'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger',
      'maintain'
    ] loop
      if pg_catalog.has_table_privilege(
        role_name, 'private.notification_deliveries', privilege_name
      ) then
        raise exception '% retained delivery table %', role_name, privilege_name;
      end if;
    end loop;
    foreach privilege_name in array array['select', 'insert', 'update', 'references'] loop
      if pg_catalog.has_any_column_privilege(
        role_name, 'private.notification_deliveries', privilege_name
      ) then
        raise exception '% retained delivery column %', role_name, privilege_name;
      end if;
    end loop;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'private.notification_deliveries'::pg_catalog.regclass
      and trigger_record.tgfoid =
        'private.prevent_dormant_notification_delivery_mutation()'::pg_catalog.regprocedure
      and trigger_record.tgenabled = 'A'
      and not trigger_record.tgisinternal
      and trigger_record.tgname = any (array[
        'notification_deliveries_dormant_rows',
        'notification_deliveries_dormant_truncate'
      ])
  ) <> 2 then
    raise exception 'delivery dormant trigger contract drifted';
  end if;
end;
$$;

-- Stable UUIDs make tie-order and cursor assertions deterministic. The auth
-- trigger creates the corresponding profile rows.
do $$
begin
  insert into auth.users(
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) values
    (
      '35000000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'notification-active@example.test',
      '',
      now(),
      '{}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    ),
    (
      '35000000-0000-4000-8000-000000000002',
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'notification-foreign@example.test',
      '',
      now(),
      '{}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    ),
    (
      '35000000-0000-4000-8000-000000000003',
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'notification-suspended@example.test',
      '',
      now(),
      '{}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );

  insert into public.profile_capabilities(profile_id, capability)
  values ('35000000-0000-4000-8000-000000000001', 'super_admin');
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '35000000-0000-4000-8000-000000000001',
    true
  );
  update public.profiles
  set is_suspended = true
  where id = '35000000-0000-4000-8000-000000000003';
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  insert into public.notifications(
    id,
    profile_id,
    source_kind,
    source_id,
    template_key,
    title,
    body,
    action_path,
    created_at
  ) values
    (
      '35000000-0000-4000-8000-000000000100',
      '35000000-0000-4000-8000-000000000001',
      'listing_order',
      '35000000-0000-4000-8000-000000001000',
      'order.placed',
      'Order received',
      'The merchant has received your order.',
      '/lagos/orders/LO-260831-0000000001',
      '2026-08-31 04:00:00+00'
    ),
    (
      '35000000-0000-4000-8000-000000000101',
      '35000000-0000-4000-8000-000000000001',
      'listing_request',
      '35000000-0000-4000-8000-000000001001',
      'request.accepted',
      'Request accepted',
      'A merchant accepted your request.',
      '/lagos/listings/shop~item/request/LR-260831-0000000001',
      '2026-08-31 05:00:00+00'
    ),
    (
      '35000000-0000-4000-8000-000000000102',
      '35000000-0000-4000-8000-000000000001',
      'listing_order',
      '35000000-0000-4000-8000-000000001002',
      'order.confirmed',
      'Order confirmed',
      'The merchant confirmed your order.',
      '/lagos/orders/LO-260831-0000000002',
      '2026-08-31 05:00:00+00'
    ),
    (
      '35000000-0000-4000-8000-000000000200',
      '35000000-0000-4000-8000-000000000002',
      'listing_order',
      '35000000-0000-4000-8000-000000001000',
      'order.placed',
      'Order received',
      'The merchant has received your order.',
      '/lagos/orders/LO-260831-0000000001',
      '2026-08-31 04:00:00+00'
    ),
    (
      '35000000-0000-4000-8000-000000000300',
      '35000000-0000-4000-8000-000000000003',
      'listing_order',
      '35000000-0000-4000-8000-000000001003',
      'order.placed',
      'Order received',
      'The merchant has received your order.',
      '/lagos/orders/LO-260831-0000000003',
      '2026-08-31 04:00:00+00'
    );
end;
$$;

-- Constraints bound display copy, internal keys, local routes, and identity.
do $$
begin
  begin
    insert into public.notifications(
      profile_id, source_kind, source_id, template_key, title, body, action_path
    ) values (
      '35000000-0000-4000-8000-000000000001',
      'listing_order',
      extensions.gen_random_uuid(),
      'order.invalid_path',
      'Invalid path',
      'This row must not be stored.',
      '//attacker.example/path'
    );
    raise exception 'invalid notification action path unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    insert into public.notifications(
      profile_id, source_kind, source_id, template_key, title, body
    ) values (
      '35000000-0000-4000-8000-000000000001',
      'listing_order',
      extensions.gen_random_uuid(),
      'order.invalid_title',
      'line' || chr(10) || 'break',
      'This row must not be stored.'
    );
    raise exception 'control-bearing notification title unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    insert into public.notifications(
      profile_id, source_kind, source_id, template_key, title, body
    ) values (
      '35000000-0000-4000-8000-000000000001',
      'listing_order',
      '35000000-0000-4000-8000-000000001000',
      'order.placed',
      'Duplicate',
      'This duplicate notification identity must not be stored.'
    );
    raise exception 'duplicate notification identity unexpectedly worked';
  exception when unique_violation then null;
  end;

  begin
    insert into public.notifications(
      profile_id, source_kind, source_id, template_key, title, body, read_at
    ) values (
      '35000000-0000-4000-8000-000000000001',
      'listing_order',
      extensions.gen_random_uuid(),
      'order.pre_read',
      'Pre-read',
      'This notification must begin unread.',
      now()
    );
    raise exception 'pre-read notification unexpectedly worked';
  exception when check_violation then null;
  end;
end;
$$;

-- Anonymous users have neither direct inbox access nor RPC execution.
set local role anon;
do $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  begin
    perform id from public.notifications limit 1;
    raise exception 'anonymous notification read unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.list_my_notifications();
    raise exception 'anonymous notification RPC unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- service_role receives neither a direct inbox path nor either user RPC.
-- Its usual RLS bypass must not turn into an accidental notification writer.
set local role service_role;
do $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  begin
    perform id from public.notifications limit 1;
    raise exception 'service role notification read unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.notifications default values;
    raise exception 'service role notification insert unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.list_my_notifications();
    raise exception 'service role notification list RPC unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.mark_my_notification_read(
      '35000000-0000-4000-8000-000000000100'
    );
    raise exception 'service role notification mark-read RPC unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Active owners see only themselves. Tie ordering is UUID-descending, cursor
-- fields are atomic, unread filtering works, and read mutation is idempotent.
set local role authenticated;
do $$
declare
  listed_ids uuid[];
  result record;
  first_read_at timestamptz;
begin
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"35000000-0000-4000-8000-000000000001"}',
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '35000000-0000-4000-8000-000000000001',
    true
  );

  if (select count(id) from public.notifications) <> 3 then
    raise exception 'active owner RLS visibility failed';
  end if;

  select pg_catalog.array_agg(page.notification_id order by page.created_at desc, page.notification_id desc)
  into listed_ids
  from public.list_my_notifications(2) page;
  if listed_ids is distinct from array[
    '35000000-0000-4000-8000-000000000102'::uuid,
    '35000000-0000-4000-8000-000000000101'::uuid
  ] then
    raise exception 'notification limit or tie ordering failed';
  end if;

  select pg_catalog.array_agg(page.notification_id order by page.created_at desc, page.notification_id desc)
  into listed_ids
  from public.list_my_notifications(
    20,
    '2026-08-31 05:00:00+00',
    '35000000-0000-4000-8000-000000000101',
    false
  ) page;
  if listed_ids is distinct from array[
    '35000000-0000-4000-8000-000000000100'::uuid
  ] then
    raise exception 'notification keyset cursor failed';
  end if;

  begin
    perform * from public.list_my_notifications(0);
    raise exception 'invalid notification page limit unexpectedly worked';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform * from public.list_my_notifications(
      20,
      '2026-08-31 05:00:00+00',
      null,
      false
    );
    raise exception 'partial notification cursor unexpectedly worked';
  exception when invalid_parameter_value then null;
  end;

  select * into strict result
  from public.mark_my_notification_read(
    '35000000-0000-4000-8000-000000000100'
  );
  if result.outcome <> 'marked_read'
    or result.notification_id <> '35000000-0000-4000-8000-000000000100'
    or result.read_at is null then
    raise exception 'notification mark-read failed';
  end if;
  first_read_at := result.read_at;

  select * into strict result
  from public.mark_my_notification_read(
    '35000000-0000-4000-8000-000000000100'
  );
  if result.outcome <> 'already_read'
    or result.notification_id <> '35000000-0000-4000-8000-000000000100'
    or result.read_at is distinct from first_read_at then
    raise exception 'notification read replay was not idempotent';
  end if;

  select * into strict result
  from public.mark_my_notification_read(
    '35000000-0000-4000-8000-000000000200'
  );
  if result.outcome <> 'not_found'
    or result.notification_id is not null
    or result.read_at is not null then
    raise exception 'foreign notification existence leaked';
  end if;

  select * into strict result
  from public.mark_my_notification_read(
    '35000000-0000-4000-8000-000000009999'
  );
  if result.outcome <> 'not_found'
    or result.notification_id is not null
    or result.read_at is not null then
    raise exception 'missing notification outcome diverged from foreign';
  end if;

  if (select count(*) from public.list_my_notifications(20, null, null, true)) <> 2 then
    raise exception 'notification unread filter failed';
  end if;

  begin
    update public.notifications
    set read_at = null
    where id = '35000000-0000-4000-8000-000000000100';
    raise exception 'direct notification update unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- A different active owner sees only their row. A suspended owner sees none and
-- both inbox RPCs reject before probing notification existence.
do $$
declare result record;
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '35000000-0000-4000-8000-000000000002',
    true
  );
  if (select count(id) from public.notifications) <> 1
    or (select count(*) from public.list_my_notifications()) <> 1 then
    raise exception 'foreign active owner isolation failed';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '35000000-0000-4000-8000-000000000003',
    true
  );
  if exists (select id from public.notifications) then
    raise exception 'suspended owner retained direct inbox visibility';
  end if;
  begin
    perform * from public.list_my_notifications();
    raise exception 'suspended owner list unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
  begin
    select * into result
    from public.mark_my_notification_read(
      '35000000-0000-4000-8000-000000000300'
    );
    raise exception 'suspended owner mark-read unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Direct provider delivery mutations are denied even to postgres and when
-- ordinary triggers are suppressed for replication.
set local role postgres;
do $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  begin
    insert into private.notification_deliveries(
      notification_id,
      channel,
      idempotency_key_sha256
    ) values (
      '35000000-0000-4000-8000-000000000100',
      'email',
      pg_catalog.repeat('a', 64)
    );
    raise exception 'dormant delivery insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000'
      or sqlerrm <> 'notification deliveries are dormant' then
      raise;
    end if;
  end;

  begin
    truncate private.notification_deliveries;
    raise exception 'dormant delivery truncate unexpectedly worked';
  exception when others then
    if sqlstate <> '55000'
      or sqlerrm <> 'notification deliveries are dormant' then
      raise;
    end if;
  end;
end;
$$;

set local session_replication_role = replica;
do $$
begin
  begin
    insert into private.notification_deliveries(
      notification_id,
      channel,
      idempotency_key_sha256
    ) values (
      '35000000-0000-4000-8000-000000000100',
      'sms',
      pg_catalog.repeat('b', 64)
    );
    raise exception 'replica-mode dormant delivery insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000'
      or sqlerrm <> 'notification deliveries are dormant' then
      raise;
    end if;
  end;
end;
$$;
set local session_replication_role = origin;

-- Temporarily disable only the row blocker to exercise structural checks. It
-- is restored as ENABLE ALWAYS before cleanup and the final metadata check.
alter table private.notification_deliveries
  disable trigger notification_deliveries_dormant_rows;

insert into private.notification_deliveries(
  id,
  notification_id,
  channel,
  idempotency_key_sha256
) values (
  '35000000-0000-4000-8000-000000000400',
  '35000000-0000-4000-8000-000000000100',
  'email',
  pg_catalog.repeat('c', 64)
);

do $$
begin
  begin
    insert into private.notification_deliveries(
      notification_id,
      channel,
      idempotency_key_sha256
    ) values (
      '35000000-0000-4000-8000-000000000101',
      'fax',
      pg_catalog.repeat('d', 64)
    );
    raise exception 'invalid delivery channel unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    insert into private.notification_deliveries(
      notification_id,
      channel,
      idempotency_key_sha256
    ) values (
      '35000000-0000-4000-8000-000000000101',
      'sms',
      'not-a-sha256'
    );
    raise exception 'invalid delivery idempotency hash unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    insert into private.notification_deliveries(
      notification_id,
      channel,
      idempotency_key_sha256,
      status,
      attempt_count,
      last_attempt_at,
      last_error_code,
      available_at
    ) values (
      '35000000-0000-4000-8000-000000000101',
      'push',
      pg_catalog.repeat('e', 64),
      'retryable_failed',
      20,
      now(),
      'provider_timeout',
      now() + interval '1 minute'
    );
    raise exception 'exhausted retryable delivery unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    insert into private.notification_deliveries(
      notification_id,
      channel,
      idempotency_key_sha256,
      status,
      provider_code,
      completed_at
    ) values (
      '35000000-0000-4000-8000-000000000101',
      'voice',
      pg_catalog.repeat('f', 64),
      'provider_accepted',
      'provider_test',
      now()
    );
    raise exception 'zero-attempt provider acceptance unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    insert into private.notification_deliveries(
      notification_id,
      channel,
      idempotency_key_sha256,
      status,
      attempt_count,
      last_attempt_at,
      last_error_code,
      completed_at,
      created_at,
      updated_at
    ) values (
      '35000000-0000-4000-8000-000000000101',
      'push',
      pg_catalog.repeat('0', 64),
      'terminal_failed',
      1,
      now(),
      'provider_rejected',
      now() - interval '1 minute',
      now() - interval '2 minutes',
      now()
    );
    raise exception 'completion before last attempt unexpectedly worked';
  exception when check_violation then null;
  end;
end;
$$;

delete from private.notification_deliveries
where id = '35000000-0000-4000-8000-000000000400';

alter table private.notification_deliveries
  enable always trigger notification_deliveries_dormant_rows;

do $$
begin
  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'private.notification_deliveries'::pg_catalog.regclass
      and trigger_record.tgfoid =
        'private.prevent_dormant_notification_delivery_mutation()'::pg_catalog.regprocedure
      and trigger_record.tgenabled = 'A'
      and not trigger_record.tgisinternal
  ) <> 2 then
    raise exception 'delivery blockers were not restored';
  end if;

  if exists (select 1 from private.notification_deliveries) then
    raise exception 'left notification fixture residue in delivery ledger';
  end if;

  delete from auth.users
  where id in (
    '35000000-0000-4000-8000-000000000001',
    '35000000-0000-4000-8000-000000000002',
    '35000000-0000-4000-8000-000000000003'
  );

  if exists (select 1 from public.notifications) then
    raise exception 'left notification fixture residue';
  end if;
end;
$$;

rollback;
