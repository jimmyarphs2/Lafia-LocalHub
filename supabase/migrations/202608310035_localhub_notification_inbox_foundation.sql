-- Step 26A replaces the unused legacy notification placeholder with a bounded
-- in-app inbox contract. Provider delivery state is defined privately but is
-- deliberately dormant: this migration creates no enqueue or worker surface.

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Lock parents before the child and hold an exclusive child lock across every
-- catalog precondition so a concurrent writer or DDL statement cannot race the
-- destructive, zero-row-only legacy replacement.
lock table public.profiles, public.markets in share row exclusive mode;
lock table public.notifications in access exclusive mode;

do $$
declare
  actual_columns text[];
  actual_constraints text[];
  actual_indexes text[];
  actual_policies text[];
  authenticated_oid oid := (select oid from pg_catalog.pg_roles where rolname = 'authenticated');
  service_role_oid oid := (select oid from pg_catalog.pg_roles where rolname = 'service_role');
  update_columns text[];
begin
  if exists (select 1 from public.notifications) then
    raise exception 'legacy notification surface precondition failed: table is not empty'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(attribute_record.attname order by attribute_record.attnum)
  into actual_columns
  from pg_catalog.pg_attribute attribute_record
  where attribute_record.attrelid = 'public.notifications'::pg_catalog.regclass
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped;

  if actual_columns is distinct from array[
    'id',
    'profile_id',
    'channel',
    'template_key',
    'payload',
    'status',
    'sent_at',
    'read_at',
    'created_at'
  ]::text[] then
    raise exception 'legacy notification surface precondition failed: column set drifted'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute attribute_record
    left join pg_catalog.pg_attrdef default_record
      on default_record.adrelid = attribute_record.attrelid
      and default_record.adnum = attribute_record.attnum
    where attribute_record.attrelid = 'public.notifications'::pg_catalog.regclass
      and attribute_record.attnum > 0
      and not attribute_record.attisdropped
      and (
        (attribute_record.attname = 'id' and (
          attribute_record.atttypid <> 'uuid'::pg_catalog.regtype
          or not attribute_record.attnotnull
          or coalesce(pg_catalog.pg_get_expr(default_record.adbin, default_record.adrelid), '')
            !~ '(^|\.)gen_random_uuid\(\)$'
        ))
        or (attribute_record.attname = 'profile_id' and (
          attribute_record.atttypid <> 'uuid'::pg_catalog.regtype
          or not attribute_record.attnotnull
          or default_record.oid is not null
        ))
        or (attribute_record.attname in ('channel', 'template_key', 'status') and (
          attribute_record.atttypid <> 'text'::pg_catalog.regtype
          or not attribute_record.attnotnull
        ))
        or (attribute_record.attname = 'payload' and (
          attribute_record.atttypid <> 'jsonb'::pg_catalog.regtype
          or not attribute_record.attnotnull
          or pg_catalog.pg_get_expr(default_record.adbin, default_record.adrelid) <> '''{}''::jsonb'
        ))
        or (attribute_record.attname in ('sent_at', 'read_at') and (
          attribute_record.atttypid <> 'timestamp with time zone'::pg_catalog.regtype
          or attribute_record.attnotnull
          or default_record.oid is not null
        ))
        or (attribute_record.attname = 'created_at' and (
          attribute_record.atttypid <> 'timestamp with time zone'::pg_catalog.regtype
          or not attribute_record.attnotnull
          or pg_catalog.pg_get_expr(default_record.adbin, default_record.adrelid) <> 'now()'
        ))
      )
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute attribute_record
    join pg_catalog.pg_attrdef default_record
      on default_record.adrelid = attribute_record.attrelid
      and default_record.adnum = attribute_record.attnum
    where attribute_record.attrelid = 'public.notifications'::pg_catalog.regclass
      and attribute_record.attname = 'status'
      and pg_catalog.pg_get_expr(default_record.adbin, default_record.adrelid) = '''queued''::text'
  ) then
    raise exception 'legacy notification surface precondition failed: column shape drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(constraint_record.conname order by constraint_record.conname)
  into actual_constraints
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid = 'public.notifications'::pg_catalog.regclass;

  if actual_constraints is distinct from array[
    'notifications_channel_check',
    'notifications_pkey',
    'notifications_profile_id_fkey',
    'notifications_status_check'
  ]::text[]
  or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.notifications'::pg_catalog.regclass
      and constraint_record.conname = 'notifications_pkey'
      and constraint_record.contype = 'p'
      and constraint_record.conkey = array[
        (select attnum from pg_catalog.pg_attribute
         where attrelid = 'public.notifications'::pg_catalog.regclass and attname = 'id')
      ]::smallint[]
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.notifications'::pg_catalog.regclass
      and constraint_record.conname = 'notifications_profile_id_fkey'
      and constraint_record.contype = 'f'
      and constraint_record.confrelid = 'public.profiles'::pg_catalog.regclass
      and constraint_record.conkey = array[
        (select attnum from pg_catalog.pg_attribute
         where attrelid = 'public.notifications'::pg_catalog.regclass
           and attname = 'profile_id')
      ]::smallint[]
      and constraint_record.confkey = array[
        (select attnum from pg_catalog.pg_attribute
         where attrelid = 'public.profiles'::pg_catalog.regclass
           and attname = 'id')
      ]::smallint[]
      and constraint_record.confupdtype = 'a'
      and constraint_record.confdeltype = 'c'
      and constraint_record.confmatchtype = 's'
      and not constraint_record.condeferrable
      and not constraint_record.condeferred
      and constraint_record.convalidated
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.notifications'::pg_catalog.regclass
      and constraint_record.conname = 'notifications_channel_check'
      and constraint_record.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        ~ '^CHECK \(channel = ANY \(ARRAY\[''in_app''::text, ''email''::text, ''sms''::text, ''push''::text\]\)\)$'
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.notifications'::pg_catalog.regclass
      and constraint_record.conname = 'notifications_status_check'
      and constraint_record.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        ~ '^CHECK \(status = ANY \(ARRAY\[''queued''::text, ''sent''::text, ''failed''::text, ''read''::text\]\)\)$'
  ) then
    raise exception 'legacy notification surface precondition failed: constraint set drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(index_relation.relname order by index_relation.relname)
  into actual_indexes
  from pg_catalog.pg_index index_record
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_record.indexrelid
  where index_record.indrelid = 'public.notifications'::pg_catalog.regclass;

  if actual_indexes is distinct from array[
    'notifications_pkey',
    'notifications_profile_status_idx'
  ]::text[]
  or not exists (
    select 1
    from pg_catalog.pg_index index_record
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_record.indexrelid
    where index_record.indrelid = 'public.notifications'::pg_catalog.regclass
      and index_relation.relname = 'notifications_profile_status_idx'
      and index_record.indisvalid
      and index_record.indisready
      and not index_record.indisunique
      and not index_record.indisprimary
      and index_record.indexprs is null
      and index_record.indpred is null
      and pg_catalog.pg_get_indexdef(index_record.indexrelid)
        ~ '^CREATE INDEX notifications_profile_status_idx ON public\.notifications USING btree \(profile_id, status, created_at DESC\)$'
  ) then
    raise exception 'legacy notification surface precondition failed: index set drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(policy_record.policyname order by policy_record.policyname)
  into actual_policies
  from pg_catalog.pg_policies policy_record
  where policy_record.schemaname = 'public'
    and policy_record.tablename = 'notifications';

  if actual_policies is distinct from array[
    'notifications_self',
    'notifications_self_update'
  ]::text[]
  or exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'notifications'
      and (
        policy_record.roles <> array['authenticated']::name[]
        or (
          policy_record.policyname = 'notifications_self'
          and policy_record.cmd <> 'SELECT'
        )
        or (
          policy_record.policyname = 'notifications_self_update'
          and policy_record.cmd <> 'UPDATE'
        )
      )
  ) then
    raise exception 'legacy notification surface precondition failed: policy set drifted'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.notifications'::pg_catalog.regclass
      and not trigger_record.tgisinternal
  ) or exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.confrelid = 'public.notifications'::pg_catalog.regclass
      and constraint_record.conrelid <> 'public.notifications'::pg_catalog.regclass
  ) then
    raise exception 'legacy notification surface precondition failed: dependent writer exists'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_depend dependency_record
    join pg_catalog.pg_rewrite rewrite_record
      on rewrite_record.oid = dependency_record.objid
      and dependency_record.classid = 'pg_catalog.pg_rewrite'::pg_catalog.regclass
    join pg_catalog.pg_class dependent_relation
      on dependent_relation.oid = rewrite_record.ev_class
    where dependency_record.refobjid = 'public.notifications'::pg_catalog.regclass
      and dependency_record.refobjsubid > 0
      and dependent_relation.relkind in ('v', 'm')
  ) or exists (
    select 1
    from pg_catalog.pg_depend dependency_record
    join pg_catalog.pg_proc function_record
      on function_record.oid = dependency_record.objid
      and dependency_record.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
    where dependency_record.refobjid = 'public.notifications'::pg_catalog.regclass
      and dependency_record.refobjsubid > 0
  ) or exists (
    select 1
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid = function_record.pronamespace
    where function_record.prokind in ('f', 'p')
      and namespace_record.nspname not in ('pg_catalog', 'information_schema')
      and function_record.prosrc ~* '[[:<:]]notifications[[:>:]]'
  ) then
    raise exception 'legacy notification surface precondition failed: persistent dependency exists'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regclass('private.notification_deliveries') is not null
    or pg_catalog.to_regclass('public.notifications_profile_created_id_idx') is not null
    or pg_catalog.to_regclass('public.notifications_profile_unread_created_id_idx') is not null
    or pg_catalog.to_regclass('public.notifications_market_id_fkey_idx') is not null
    or pg_catalog.to_regprocedure('public.list_my_notifications(integer,timestamp with time zone,uuid,boolean)') is not null
    or pg_catalog.to_regprocedure('public.mark_my_notification_read(uuid)') is not null
    or pg_catalog.to_regprocedure('private.enforce_notification_read_state()') is not null
    or pg_catalog.to_regprocedure('private.prevent_dormant_notification_delivery_mutation()') is not null
    or exists (
      select 1
      from pg_catalog.pg_trigger trigger_record
      where trigger_record.tgname = any (array[
        'notifications_enforce_read_state',
        'notification_deliveries_dormant_rows',
        'notification_deliveries_dormant_truncate'
      ])
        and not trigger_record.tgisinternal
    )
    or exists (
      select 1
      from pg_catalog.pg_policies policy_record
      where policy_record.schemaname = 'public'
        and policy_record.tablename = 'notifications'
        and policy_record.policyname = 'notifications_active_self_select'
    )
  then
    raise exception 'legacy notification surface precondition failed: no partial replacement objects'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables publication_record
    where publication_record.pubname = 'supabase_realtime'
      and publication_record.schemaname = 'public'
      and publication_record.tablename = 'notifications'
  ) or exists (
    select 1
    from pg_catalog.pg_class relation_record
    where relation_record.oid = 'public.notifications'::pg_catalog.regclass
      and (
        relation_record.relkind <> 'r'
        or not relation_record.relrowsecurity
        or relation_record.relforcerowsecurity
        or relation_record.relreplident <> 'd'
        or relation_record.relreplident = 'f'
        or pg_catalog.pg_get_userbyid(relation_record.relowner) <> 'postgres'
      )
  ) then
    raise exception 'legacy notification surface precondition failed: relation metadata drifted'
      using errcode = '55000';
  end if;

  if authenticated_oid is null or service_role_oid is null
    or not pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'select')
    or pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'insert')
    or pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'update')
    or pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'delete')
    or pg_catalog.has_table_privilege('anon', 'public.notifications', 'select')
    or exists (
      select 1
      from pg_catalog.pg_class relation_record
      cross join lateral pg_catalog.aclexplode(
        coalesce(relation_record.relacl, pg_catalog.acldefault('r', relation_record.relowner))
      ) privilege_record
      where relation_record.oid = 'public.notifications'::pg_catalog.regclass
        and privilege_record.grantee = 0
    )
    or exists (
      select 1
      from pg_catalog.pg_attribute attribute_record
      cross join lateral pg_catalog.aclexplode(attribute_record.attacl) privilege_record
      where attribute_record.attrelid = 'public.notifications'::pg_catalog.regclass
        and attribute_record.attnum > 0
        and not attribute_record.attisdropped
        and privilege_record.grantee = 0
    )
  then
    raise exception 'legacy notification surface precondition failed: known ACLs drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(attribute_record.attname order by attribute_record.attname)
  into update_columns
  from pg_catalog.pg_attribute attribute_record
  where attribute_record.attrelid = 'public.notifications'::pg_catalog.regclass
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped
    and pg_catalog.has_column_privilege(
      'authenticated',
      'public.notifications',
      attribute_record.attname,
      'update'
    );

  if update_columns is distinct from array['read_at', 'status']::text[] then
    raise exception 'legacy notification surface precondition failed: known column ACLs drifted'
      using errcode = '55000';
  end if;
end;
$$;

drop policy notifications_self on public.notifications;
drop policy notifications_self_update on public.notifications;

revoke all privileges on table public.notifications
  from public, anon, authenticated, service_role;
revoke all privileges (
  id,
  profile_id,
  channel,
  template_key,
  payload,
  status,
  sent_at,
  read_at,
  created_at
) on table public.notifications
  from public, anon, authenticated, service_role;

alter table public.notifications
  drop constraint notifications_channel_check,
  drop constraint notifications_status_check,
  drop column channel,
  drop column status,
  drop column sent_at,
  drop column payload,
  add column market_id uuid references public.markets(id) on delete restrict,
  add column source_kind text not null,
  add column source_id uuid not null,
  add column template_version smallint not null default 1,
  add column title text not null,
  add column body text not null,
  add column action_path text,
  add constraint notifications_source_kind_shape check (
    source_kind ~ '^[a-z][a-z0-9_]{1,62}$'
  ),
  add constraint notifications_template_key_shape check (
    template_key ~ '^[a-z][a-z0-9_.-]{2,95}$'
  ),
  add constraint notifications_template_version_fixed check (
    template_version = 1
  ),
  add constraint notifications_title_shape check (
    title = pg_catalog.btrim(title)
    and pg_catalog.char_length(title) between 1 and 120
    and pg_catalog.octet_length(title) <= 480
    and title !~ '[[:cntrl:]]'
  ),
  add constraint notifications_body_shape check (
    body = pg_catalog.btrim(body)
    and pg_catalog.char_length(body) between 1 and 600
    and pg_catalog.octet_length(body) <= 2400
    and body !~ '[[:cntrl:]]'
  ),
  add constraint notifications_action_path_shape check (
    action_path is null
    or (
      pg_catalog.octet_length(action_path) between 2 and 300
      and action_path ~ '^/[a-z][a-z0-9_-]*(/[A-Za-z0-9][A-Za-z0-9_~-]*)*$'
    )
  ),
  add constraint notifications_read_time_order check (
    read_at is null or read_at >= created_at
  ),
  add constraint notifications_recipient_source_template_unique
    unique (profile_id, source_kind, source_id, template_key, template_version);

create index notifications_profile_created_id_idx
  on public.notifications (profile_id, created_at desc, id desc);
create index notifications_profile_unread_created_id_idx
  on public.notifications (profile_id, created_at desc, id desc)
  where read_at is null;
create index notifications_market_id_fkey_idx
  on public.notifications (market_id)
  where market_id is not null;

create function private.enforce_notification_read_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.read_at is not null then
    raise exception 'new notifications must be unread'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new is distinct from old then
    if row(
      new.id,
      new.profile_id,
      new.market_id,
      new.source_kind,
      new.source_id,
      new.template_key,
      new.template_version,
      new.title,
      new.body,
      new.action_path,
      new.created_at
    ) is distinct from row(
      old.id,
      old.profile_id,
      old.market_id,
      old.source_kind,
      old.source_id,
      old.template_key,
      old.template_version,
      old.title,
      old.body,
      old.action_path,
      old.created_at
    ) then
      raise exception 'notification inbox content is immutable'
        using errcode = '55000';
    end if;

    if old.read_at is not null then
      if new.read_at is distinct from old.read_at then
        raise exception 'notification read state is irreversible'
          using errcode = '55000';
      end if;
      new.read_at := old.read_at;
    elsif new.read_at is not null then
      new.read_at := pg_catalog.statement_timestamp();
    end if;
  end if;

  return new;
end;
$$;

alter function private.enforce_notification_read_state() owner to postgres;
revoke all on function private.enforce_notification_read_state()
  from public, anon, authenticated, service_role;

create trigger notifications_enforce_read_state
before insert or update on public.notifications
for each row
execute function private.enforce_notification_read_state();
alter table public.notifications
  enable always trigger notifications_enforce_read_state;

alter table public.notifications owner to postgres;
alter table public.notifications enable row level security;
alter table public.notifications force row level security;

create policy notifications_active_self_select
  on public.notifications for select to authenticated
  using (
    profile_id = (select auth.uid())
    and (select public.is_current_profile_active())
  );

revoke all privileges on table public.notifications
  from public, anon, authenticated, service_role;
revoke all privileges (
  id,
  profile_id,
  market_id,
  source_kind,
  source_id,
  template_key,
  template_version,
  title,
  body,
  action_path,
  read_at,
  created_at
) on table public.notifications
  from public, anon, authenticated, service_role;
grant select (
  id,
  profile_id,
  market_id,
  template_key,
  template_version,
  title,
  body,
  action_path,
  read_at,
  created_at
) on public.notifications to authenticated;

create function public.list_my_notifications (
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_unread_only boolean default false
)
returns table (
  notification_id uuid,
  market_id uuid,
  template_key text,
  template_version smallint,
  title text,
  body text,
  action_path text,
  read_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select public.is_current_profile_active()) then
    raise exception 'active authentication required'
      using errcode = '42501';
  end if;

  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'notification page limit must be between 1 and 50'
      using errcode = '22023';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'notification cursor fields must be supplied together'
      using errcode = '22023';
  end if;

  return query
  select
    notification_record.id,
    notification_record.market_id,
    notification_record.template_key,
    notification_record.template_version,
    notification_record.title,
    notification_record.body,
    notification_record.action_path,
    notification_record.read_at,
    notification_record.created_at
  from public.notifications notification_record
  where notification_record.profile_id = (select auth.uid())
    and (
      p_before_created_at is null
      or (notification_record.created_at, notification_record.id)
        < (p_before_created_at, p_before_id)
    )
    and (not p_unread_only or notification_record.read_at is null)
  order by notification_record.created_at desc, notification_record.id desc
  limit p_limit;
end;
$$;

alter function public.list_my_notifications(integer, timestamptz, uuid, boolean)
  owner to postgres;
revoke all on function public.list_my_notifications(integer, timestamptz, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_notifications(integer, timestamptz, uuid, boolean)
  to authenticated;

create function public.mark_my_notification_read(p_notification_id uuid)
returns table (
  outcome text,
  notification_id uuid,
  read_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  existing_read_at timestamptz;
  marked_at timestamptz;
begin
  if p_notification_id is null then
    raise exception 'notification id is required'
      using errcode = '22023';
  end if;

  if actor is null or not (select public.is_current_profile_active()) then
    raise exception 'active authentication required'
      using errcode = '42501';
  end if;

  select notification_record.read_at
  into existing_read_at
  from public.notifications notification_record
  where notification_record.id = p_notification_id
    and notification_record.profile_id = actor
  for no key update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if existing_read_at is not null then
    return query
    select 'already_read'::text, p_notification_id, existing_read_at;
    return;
  end if;

  update public.notifications notification_record
  set read_at = pg_catalog.statement_timestamp()
  where notification_record.id = p_notification_id
    and notification_record.profile_id = actor
  returning notification_record.read_at into marked_at;

  return query select 'marked_read'::text, p_notification_id, marked_at;
end;
$$;

alter function public.mark_my_notification_read(uuid) owner to postgres;
revoke all on function public.mark_my_notification_read(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_my_notification_read(uuid)
  to authenticated;

create table private.notification_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel text not null,
  status text not null default 'pending',
  idempotency_key_sha256 text not null unique,
  attempt_count smallint not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  provider_code text,
  provider_message_id text,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_channel_shape check (
    channel in ('email', 'sms', 'push', 'voice')
  ),
  constraint notification_deliveries_status_shape check (
    status in (
      'pending',
      'leased',
      'provider_accepted',
      'retryable_failed',
      'terminal_failed',
      'suppressed'
    )
  ),
  constraint notification_deliveries_idempotency_shape check (
    idempotency_key_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint notification_deliveries_attempt_count_shape check (
    attempt_count between 0 and 20
  ),
  constraint notification_deliveries_attempt_time_shape check (
    (attempt_count = 0) = (last_attempt_at is null)
  ),
  constraint notification_deliveries_completed_attempt_shape check (
    status not in ('provider_accepted', 'terminal_failed')
    or (
      attempt_count between 1 and 20
      and last_attempt_at is not null
    )
  ),
  constraint notification_deliveries_lease_shape check (
    (
      lease_token is null
      and leased_at is null
      and lease_expires_at is null
    )
    or (
      lease_token is not null
      and leased_at is not null
      and lease_expires_at is not null
      and status = 'leased'
      and lease_expires_at > leased_at
      and lease_expires_at <= leased_at + interval '15 minutes'
    )
  ),
  constraint notification_deliveries_leased_state_shape check (
    (status = 'leased') = (lease_token is not null)
  ),
  constraint notification_deliveries_retry_shape check (
    status <> 'retryable_failed'
    or (
      attempt_count between 1 and 19
      and last_error_code is not null
      and last_attempt_at is not null
      and available_at > last_attempt_at
    )
  ),
  constraint notification_deliveries_terminal_error_shape check (
    status <> 'terminal_failed' or last_error_code is not null
  ),
  constraint notification_deliveries_provider_acceptance_shape check (
    status <> 'provider_accepted' or provider_code is not null
  ),
  constraint notification_deliveries_provider_message_shape check (
    provider_message_id is null or provider_code is not null
  ),
  constraint notification_deliveries_completion_shape check (
    (completed_at is not null) = (
      status in ('provider_accepted', 'terminal_failed', 'suppressed')
    )
  ),
  constraint notification_deliveries_provider_code_shape check (
    provider_code is null
    or (
      pg_catalog.octet_length(provider_code) between 1 and 63
      and provider_code ~ '^[a-z][a-z0-9_.-]{0,62}$'
    )
  ),
  constraint notification_deliveries_provider_message_id_shape check (
    provider_message_id is null
    or (
      provider_message_id = pg_catalog.btrim(provider_message_id)
      and pg_catalog.char_length(provider_message_id) between 1 and 200
      and pg_catalog.octet_length(provider_message_id) <= 800
      and provider_message_id !~ '[[:cntrl:]]'
    )
  ),
  constraint notification_deliveries_error_code_shape check (
    last_error_code is null
    or (
      pg_catalog.octet_length(last_error_code) between 1 and 63
      and last_error_code ~ '^[a-z][a-z0-9_.-]{0,62}$'
    )
  ),
  constraint notification_deliveries_time_order check (
    available_at >= created_at
    and updated_at >= created_at
    and (leased_at is null or leased_at >= created_at)
    and (last_attempt_at is null or last_attempt_at >= created_at)
    and (completed_at is null or completed_at >= created_at)
    and (
      completed_at is null
      or last_attempt_at is null
      or completed_at >= last_attempt_at
    )
  ),
  constraint notification_deliveries_notification_channel_unique
    unique (notification_id, channel)
);

create unique index notification_deliveries_provider_message_unique_idx
  on private.notification_deliveries (provider_code, provider_message_id)
  where provider_message_id is not null;
create index notification_deliveries_ready_idx
  on private.notification_deliveries (channel, available_at, created_at, id)
  where status in ('pending', 'retryable_failed');
create index notification_deliveries_expired_lease_idx
  on private.notification_deliveries (lease_expires_at)
  where status = 'leased';

alter table private.notification_deliveries owner to postgres;
alter table private.notification_deliveries enable row level security;
alter table private.notification_deliveries force row level security;

revoke all on table private.notification_deliveries
  from public, anon, authenticated, service_role;
revoke all privileges (
  id,
  notification_id,
  channel,
  status,
  idempotency_key_sha256,
  attempt_count,
  available_at,
  lease_token,
  leased_at,
  lease_expires_at,
  last_attempt_at,
  provider_code,
  provider_message_id,
  last_error_code,
  completed_at,
  created_at,
  updated_at
) on table private.notification_deliveries
  from public, anon, authenticated, service_role;

create function private.prevent_dormant_notification_delivery_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'notification deliveries are dormant'
    using errcode = '55000';
end;
$$;

alter function private.prevent_dormant_notification_delivery_mutation()
  owner to postgres;
revoke all on function private.prevent_dormant_notification_delivery_mutation()
  from public, anon, authenticated, service_role;

create trigger notification_deliveries_dormant_rows
before insert or update or delete on private.notification_deliveries
for each row
execute function private.prevent_dormant_notification_delivery_mutation();
create trigger notification_deliveries_dormant_truncate
before truncate on private.notification_deliveries
for each statement
execute function private.prevent_dormant_notification_delivery_mutation();
alter table private.notification_deliveries
  enable always trigger notification_deliveries_dormant_rows;
alter table private.notification_deliveries
  enable always trigger notification_deliveries_dormant_truncate;

comment on table public.notifications is
  'Bounded in-app inbox. Content is immutable and read state changes only through the authenticated RPC.';
comment on table private.notification_deliveries is
  'Dormant provider-neutral delivery state. No enqueue, claim, worker, or provider integration is active.';

-- Executable postconditions keep the public/private boundary and dormant
-- delivery posture from silently weakening during the migration itself.
do $$
declare
  actual_columns text[];
  actual_constraints text[];
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
    raise exception 'notification inbox postcondition failed: column set drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(constraint_record.conname order by constraint_record.conname)
  into actual_constraints
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid = 'public.notifications'::pg_catalog.regclass;

  if actual_constraints is distinct from array[
    'notifications_action_path_shape',
    'notifications_body_shape',
    'notifications_market_id_fkey',
    'notifications_pkey',
    'notifications_profile_id_fkey',
    'notifications_read_time_order',
    'notifications_recipient_source_template_unique',
    'notifications_source_kind_shape',
    'notifications_template_key_shape',
    'notifications_template_version_fixed',
    'notifications_title_shape'
  ]::text[]
  or exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.notifications'::pg_catalog.regclass
      and constraint_record.contype = 'f'
      and constraint_record.conname in (
        'notifications_profile_id_fkey',
        'notifications_market_id_fkey'
      )
      and (
        not constraint_record.convalidated
        or constraint_record.confupdtype <> 'a'
        or constraint_record.confmatchtype <> 's'
        or constraint_record.condeferrable
        or constraint_record.condeferred
        or (
          constraint_record.conname = 'notifications_profile_id_fkey'
          and (
            constraint_record.confrelid <> 'public.profiles'::pg_catalog.regclass
            or constraint_record.confdeltype <> 'c'
            or constraint_record.conkey <> array[
              (select attnum from pg_catalog.pg_attribute
               where attrelid = 'public.notifications'::pg_catalog.regclass
                 and attname = 'profile_id')
            ]::smallint[]
            or constraint_record.confkey <> array[
              (select attnum from pg_catalog.pg_attribute
               where attrelid = 'public.profiles'::pg_catalog.regclass
                 and attname = 'id')
            ]::smallint[]
          )
        )
        or (
          constraint_record.conname = 'notifications_market_id_fkey'
          and (
            constraint_record.confrelid <> 'public.markets'::pg_catalog.regclass
            or constraint_record.confdeltype <> 'r'
            or constraint_record.conkey <> array[
              (select attnum from pg_catalog.pg_attribute
               where attrelid = 'public.notifications'::pg_catalog.regclass
                 and attname = 'market_id')
            ]::smallint[]
            or constraint_record.confkey <> array[
              (select attnum from pg_catalog.pg_attribute
               where attrelid = 'public.markets'::pg_catalog.regclass
                 and attname = 'id')
            ]::smallint[]
          )
        )
      )
  ) then
    raise exception 'notification inbox postcondition failed: constraint set drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(index_relation.relname order by index_relation.relname)
  into actual_indexes
  from pg_catalog.pg_index index_record
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_record.indexrelid
  where index_record.indrelid = 'public.notifications'::pg_catalog.regclass
    and index_record.indisvalid
    and index_record.indisready;

  if actual_indexes is distinct from array[
    'notifications_market_id_fkey_idx',
    'notifications_pkey',
    'notifications_profile_created_id_idx',
    'notifications_profile_unread_created_id_idx',
    'notifications_recipient_source_template_unique'
  ]::text[] then
    raise exception 'notification inbox postcondition failed: index set drifted'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation_record
    where relation_record.oid = 'public.notifications'::pg_catalog.regclass
      and relation_record.relkind = 'r'
      and relation_record.relrowsecurity
      and relation_record.relforcerowsecurity
      and relation_record.relreplident <> 'f'
      and pg_catalog.pg_get_userbyid(relation_record.relowner) = 'postgres'
  ) or (
    select count(*)
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'notifications'
      and policy_record.policyname = 'notifications_active_self_select'
      and policy_record.cmd = 'SELECT'
      and policy_record.roles = array['authenticated']::name[]
  ) <> 1 or (
    select count(*)
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'notifications'
  ) <> 1 then
    raise exception 'notification inbox postcondition failed: RLS contract drifted'
      using errcode = '55000';
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
    raise exception 'notification inbox postcondition failed: publication scope drifted'
      using errcode = '55000';
  end if;

  foreach role_name in array array['anon', 'service_role'] loop
    foreach privilege_name in array array[
      'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger',
      'maintain'
    ] loop
      if pg_catalog.has_table_privilege(
        role_name,
        'public.notifications',
        privilege_name
      ) then
        raise exception 'notification inbox postcondition failed: table ACL remains'
          using errcode = '55000';
      end if;
    end loop;
    foreach privilege_name in array array['select', 'insert', 'update', 'references'] loop
      if pg_catalog.has_any_column_privilege(
        role_name,
        'public.notifications',
        privilege_name
      ) then
        raise exception 'notification inbox postcondition failed: column ACL remains'
          using errcode = '55000';
      end if;
    end loop;
  end loop;

  if pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'select')
    or pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'insert')
    or pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'update')
    or pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'delete')
    or pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'truncate')
    or pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'references')
    or pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'trigger')
    or pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'maintain')
    or not pg_catalog.has_any_column_privilege(
      'authenticated', 'public.notifications', 'select'
    )
    or pg_catalog.has_any_column_privilege(
      'authenticated', 'public.notifications', 'update'
    )
    or pg_catalog.has_column_privilege(
      'authenticated', 'public.notifications', 'source_kind', 'select'
    )
    or pg_catalog.has_column_privilege(
      'authenticated', 'public.notifications', 'source_id', 'select'
    ) then
    raise exception 'notification inbox postcondition failed: authenticated ACL drifted'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.notifications'::pg_catalog.regclass
      and trigger_record.tgfoid =
        'private.enforce_notification_read_state()'::pg_catalog.regprocedure
      and trigger_record.tgname = 'notifications_enforce_read_state'
      and trigger_record.tgenabled = 'A'
      and not trigger_record.tgisinternal
  ) <> 1 then
    raise exception 'notification inbox postcondition failed: read-state trigger drifted'
      using errcode = '55000';
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
      raise exception 'notification inbox postcondition failed: RPC contract drifted'
        using errcode = '55000';
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_class relation_record
    where relation_record.oid = 'private.notification_deliveries'::pg_catalog.regclass
      and relation_record.relkind = 'r'
      and relation_record.relrowsecurity
      and relation_record.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation_record.relowner) = 'postgres'
  ) or exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'private'
      and policy_record.tablename = 'notification_deliveries'
  ) then
    raise exception 'notification inbox postcondition failed: delivery RLS drifted'
      using errcode = '55000';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    foreach privilege_name in array array[
      'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger',
      'maintain'
    ] loop
      if pg_catalog.has_table_privilege(
        role_name,
        'private.notification_deliveries',
        privilege_name
      ) then
        raise exception 'notification inbox postcondition failed: delivery ACL remains'
          using errcode = '55000';
      end if;
    end loop;
    foreach privilege_name in array array['select', 'insert', 'update', 'references'] loop
      if pg_catalog.has_any_column_privilege(
        role_name,
        'private.notification_deliveries',
        privilege_name
      ) then
        raise exception 'notification inbox postcondition failed: delivery column ACL remains'
          using errcode = '55000';
      end if;
    end loop;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'private.notification_deliveries'::pg_catalog.regclass
      and trigger_record.tgfoid =
        'private.prevent_dormant_notification_delivery_mutation()'::pg_catalog.regprocedure
      and trigger_record.tgenabled = 'A'
      and not trigger_record.tgisinternal
      and trigger_record.tgname = any (array[
        'notification_deliveries_dormant_rows',
        'notification_deliveries_dormant_truncate'
      ])
  ) <> 2 then
    raise exception 'notification inbox postcondition failed: dormant blockers drifted'
      using errcode = '55000';
  end if;
end;
$$;
