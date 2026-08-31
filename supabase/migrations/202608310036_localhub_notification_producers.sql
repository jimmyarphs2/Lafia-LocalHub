-- Transactional in-app notification producers for the five already-approved
-- request, order, and fulfilment write boundaries. No table trigger, provider
-- delivery, destination, external channel, or historical backfill is enabled.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

lock table public.profiles, public.markets, public.businesses,
  public.business_memberships, public.listings, public.guest_intents,
  public.requests, public.orders, public.order_fulfilments,
  public.notifications, private.notification_deliveries
  in share row exclusive mode;

do $$
declare
  actual_names text[];
  function_record pg_catalog.pg_proc%rowtype;
  function_signature text;
  role_name text;
begin
  if exists (select 1 from public.requests)
    or exists (select 1 from public.orders)
    or exists (select 1 from public.order_fulfilments)
    or exists (select 1 from public.notifications)
    or exists (select 1 from private.notification_deliveries) then
    raise exception 'notification producer precondition failed: source and notification relations must be empty'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure(
      'private.enqueue_fixed_in_app_notification(text,uuid)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'private.create_listing_request_from_intent_source_boundary(uuid,text)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'private.respond_to_listing_request_source_boundary(uuid,text,uuid)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'private.create_listing_order_from_intent_source_boundary(uuid)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'private.respond_to_listing_order_source_boundary(uuid,text,uuid)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'private.start_listing_order_fulfilment_source_boundary(uuid,uuid)'
    ) is not null then
    raise exception 'notification producer precondition failed: no partial notification producer objects'
      using errcode = '55000';
  end if;

  foreach function_signature in array array[
    'public.create_listing_request_from_intent(uuid,text)',
    'public.respond_to_listing_request(uuid,text,uuid)',
    'public.create_listing_order_from_intent(uuid)',
    'public.respond_to_listing_order(uuid,text,uuid)',
    'public.start_listing_order_fulfilment(uuid,uuid)'
  ] loop
    if pg_catalog.to_regprocedure(function_signature) is null then
      raise exception 'notification source rpc precondition drifted: % is absent',
        function_signature using errcode = '55000';
    end if;

    select routine_record.* into strict function_record
    from pg_catalog.pg_proc routine_record
    where routine_record.oid = function_signature::pg_catalog.regprocedure;

    if pg_catalog.pg_get_userbyid(function_record.proowner) <> 'postgres'
      or not function_record.prosecdef
      or function_record.prokind <> 'f'
      or not coalesce(function_record.proconfig, array[]::text[])
        @> array['search_path=""']::text[]
      or not pg_catalog.has_function_privilege(
        'authenticated', function_signature, 'execute'
      )
      or pg_catalog.has_function_privilege('anon', function_signature, 'execute')
      or pg_catalog.has_function_privilege(
        'service_role', function_signature, 'execute'
      )
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
      ) then
      raise exception 'notification source rpc precondition drifted: % contract changed',
        function_signature using errcode = '55000';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_depend dependency_record
    where dependency_record.refobjid = any (array[
      'public.create_listing_request_from_intent(uuid,text)'::pg_catalog.regprocedure,
      'public.respond_to_listing_request(uuid,text,uuid)'::pg_catalog.regprocedure,
      'public.create_listing_order_from_intent(uuid)'::pg_catalog.regprocedure,
      'public.respond_to_listing_order(uuid,text,uuid)'::pg_catalog.regprocedure,
      'public.start_listing_order_fulfilment(uuid,uuid)'::pg_catalog.regprocedure
    ]::oid[])
      and dependency_record.classid in (
        'pg_catalog.pg_proc'::pg_catalog.regclass,
        'pg_catalog.pg_rewrite'::pg_catalog.regclass,
        'pg_catalog.pg_trigger'::pg_catalog.regclass
      )
      and dependency_record.deptype not in ('i', 'e')
  ) or exists (
    select 1
    from pg_catalog.pg_proc routine_record
    where routine_record.oid <> all (array[
      'public.create_listing_request_from_intent(uuid,text)'::pg_catalog.regprocedure,
      'public.respond_to_listing_request(uuid,text,uuid)'::pg_catalog.regprocedure,
      'public.create_listing_order_from_intent(uuid)'::pg_catalog.regprocedure,
      'public.respond_to_listing_order(uuid,text,uuid)'::pg_catalog.regprocedure,
      'public.start_listing_order_fulfilment(uuid,uuid)'::pg_catalog.regprocedure
    ]::oid[])
      and routine_record.prosrc ~* 'public[.](create_listing_request_from_intent|respond_to_listing_request|create_listing_order_from_intent|respond_to_listing_order|start_listing_order_fulfilment)[[:space:]]*[(]'
  ) then
    raise exception 'notification producer precondition failed: no persistent source rpc dependencies'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(trigger_record.tgname order by trigger_record.tgname)
  into actual_names
  from pg_catalog.pg_trigger trigger_record
  where trigger_record.tgrelid = 'public.requests'::pg_catalog.regclass
    and not trigger_record.tgisinternal
    and trigger_record.tgenabled = 'O';
  if actual_names is distinct from array[
    'requests_enforce_listing_request_response_transition',
    'requests_set_updated_at',
    'requests_validate_listing_request_linkage',
    'requests_validate_market'
  ]::text[] then
    raise exception 'notification source mutation guard surface drifted: requests'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(trigger_record.tgname order by trigger_record.tgname)
  into actual_names
  from pg_catalog.pg_trigger trigger_record
  where trigger_record.tgrelid = 'public.orders'::pg_catalog.regclass
    and not trigger_record.tgisinternal
    and trigger_record.tgenabled = 'O';
  if actual_names is distinct from array[
    'orders_protect_listing_order_snapshot',
    'orders_set_updated_at',
    'orders_validate_market'
  ]::text[] then
    raise exception 'notification source mutation guard surface drifted: orders'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(trigger_record.tgname order by trigger_record.tgname)
  into actual_names
  from pg_catalog.pg_trigger trigger_record
  where trigger_record.tgrelid = 'public.order_fulfilments'::pg_catalog.regclass
    and not trigger_record.tgisinternal
    and trigger_record.tgenabled = 'O';
  if actual_names is distinct from array[
    'order_fulfilments_protect_listing_order_processing'
  ]::text[] then
    raise exception 'notification source mutation guard surface drifted: fulfilments'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(policy_record.policyname order by policy_record.policyname)
  into actual_names
  from pg_catalog.pg_policies policy_record
  where policy_record.schemaname = 'public'
    and policy_record.tablename = 'requests';
  if actual_names is distinct from array[
    'requests_customer_select',
    'requests_selected_business_member_select'
  ]::text[] then
    raise exception 'notification source rls policy drifted: requests'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(policy_record.policyname order by policy_record.policyname)
  into actual_names
  from pg_catalog.pg_policies policy_record
  where policy_record.schemaname = 'public'
    and policy_record.tablename = 'orders';
  if actual_names is distinct from array[
    'orders_active_customer_or_vendor_select'
  ]::text[] then
    raise exception 'notification source rls policy drifted: orders'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(policy_record.policyname order by policy_record.policyname)
  into actual_names
  from pg_catalog.pg_policies policy_record
  where policy_record.schemaname = 'public'
    and policy_record.tablename = 'order_fulfilments';
  if actual_names is distinct from array[
    'order_fulfilments_active_customer_or_vendor_select'
  ]::text[] then
    raise exception 'notification source rls policy drifted: fulfilments'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid in (
      'public.requests'::pg_catalog.regclass,
      'public.orders'::pg_catalog.regclass,
      'public.order_fulfilments'::pg_catalog.regclass
    )
      and not constraint_record.convalidated
  ) or not exists (
    select 1 from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.requests'::pg_catalog.regclass
      and constraint_record.conname = 'requests_listing_request_shape'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.requests'::pg_catalog.regclass
      and constraint_record.conname = 'requests_status_domain'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.requests'::pg_catalog.regclass
      and constraint_record.conname = 'requests_listing_response_consistency'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.orders'::pg_catalog.regclass
      and constraint_record.conname = 'orders_listing_order_snapshot_shape'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.order_fulfilments'::pg_catalog.regclass
      and constraint_record.conname = 'order_fulfilments_order_id_key'
  ) then
    raise exception 'notification source constraint surface drifted'
      using errcode = '55000';
  end if;

  foreach role_name in array array['public', 'anon', 'authenticated'] loop
    if pg_catalog.has_table_privilege(role_name, 'public.requests', 'insert')
      or pg_catalog.has_table_privilege(role_name, 'public.requests', 'update')
      or pg_catalog.has_table_privilege(role_name, 'public.requests', 'delete')
      or pg_catalog.has_table_privilege(role_name, 'public.requests', 'truncate')
      or pg_catalog.has_table_privilege(role_name, 'public.orders', 'insert')
      or pg_catalog.has_table_privilege(role_name, 'public.orders', 'update')
      or pg_catalog.has_table_privilege(role_name, 'public.orders', 'delete')
      or pg_catalog.has_table_privilege(role_name, 'public.orders', 'truncate')
      or pg_catalog.has_table_privilege(role_name, 'public.order_fulfilments', 'insert')
      or pg_catalog.has_table_privilege(role_name, 'public.order_fulfilments', 'update')
      or pg_catalog.has_table_privilege(role_name, 'public.order_fulfilments', 'delete')
      or pg_catalog.has_table_privilege(role_name, 'public.order_fulfilments', 'truncate') then
      raise exception 'notification source dml acl drifted: %', role_name
        using errcode = '55000';
    end if;
  end loop;

  -- This exact dormant legacy grant came from the foundation bootstrap. Close
  -- it below rather than treating it as an approved producer entry point.
  if not pg_catalog.has_table_privilege(
      'service_role', 'public.requests', 'insert'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.requests', 'update'
    )
    or not pg_catalog.has_table_privilege(
      'service_role', 'public.requests', 'delete'
    )
    or not pg_catalog.has_table_privilege(
      'service_role', 'public.requests', 'truncate'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.orders', 'insert'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.orders', 'update'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.orders', 'delete'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.orders', 'truncate'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.order_fulfilments', 'insert'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.order_fulfilments', 'update'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.order_fulfilments', 'delete'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.order_fulfilments', 'truncate'
    ) then
    raise exception 'notification source dml acl drifted: service_role legacy surface'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(
    privilege_record.privilege_type order by privilege_record.privilege_type
  ) into actual_names
  from pg_catalog.pg_class relation_record
  cross join lateral pg_catalog.aclexplode(relation_record.relacl)
    privilege_record
  where relation_record.oid = 'public.requests'::pg_catalog.regclass
    and privilege_record.grantee = (
      select role_record.oid from pg_catalog.pg_roles role_record
      where role_record.rolname = 'service_role'
    )
    and privilege_record.privilege_type in (
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'
    )
    and not privilege_record.is_grantable;
  if actual_names is distinct from array[
    'DELETE', 'INSERT', 'TRUNCATE'
  ]::text[] then
    raise exception 'notification source dml acl drifted: direct legacy grant'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute_record
    where attribute_record.attrelid = 'public.notifications'::pg_catalog.regclass
      and attribute_record.attname = 'profile_id'
      and attribute_record.attnotnull
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.notifications'::pg_catalog.regclass
      and constraint_record.conname = 'notifications_profile_id_fkey'
      and constraint_record.confrelid = 'public.profiles'::pg_catalog.regclass
      and constraint_record.confdeltype = 'c'
  ) or (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.notifications'::pg_catalog.regclass
      and trigger_record.tgname = 'notifications_enforce_read_state'
      and trigger_record.tgfoid =
        'private.enforce_notification_read_state()'::pg_catalog.regprocedure
      and trigger_record.tgenabled = 'A'
      and not trigger_record.tgisinternal
  ) <> 1 then
    raise exception 'notification producer precondition failed: inbox retention surface drifted'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation_record
    where relation_record.oid = 'public.notifications'::pg_catalog.regclass
      and relation_record.relrowsecurity
      and relation_record.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation_record.relowner) = 'postgres'
  ) or (
    select count(*)
    from pg_catalog.pg_policy policy_record
    where policy_record.polrelid = 'public.notifications'::pg_catalog.regclass
      and policy_record.polname = 'notifications_active_self_select'
      and policy_record.polpermissive
      and policy_record.polcmd = 'r'
      and policy_record.polroles = array[(
        select role_record.oid from pg_catalog.pg_roles role_record
        where role_record.rolname = 'authenticated'
      )]::oid[]
      and policy_record.polwithcheck is null
      and pg_catalog.pg_get_expr(
        policy_record.polqual, policy_record.polrelid
      ) = '((profile_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_current_profile_active() AS is_current_profile_active))'
  ) <> 1 or (
    select count(*) from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'notifications'
  ) <> 1 then
    raise exception 'notification inbox rls surface drifted'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables publication_record
    where publication_record.pubname = 'supabase_realtime'
      and publication_record.schemaname = 'public'
      and publication_record.tablename = 'notifications'
  ) then
    raise exception 'notification realtime deletion safety drifted: inbox is not published'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'private'
      and policy_record.tablename = 'notification_deliveries'
  ) or (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'private.notification_deliveries'::pg_catalog.regclass
      and trigger_record.tgfoid =
        'private.prevent_dormant_notification_delivery_mutation()'::pg_catalog.regprocedure
      and trigger_record.tgenabled = 'A'
      and not trigger_record.tgisinternal
  ) <> 2 then
    raise exception 'notification delivery dormancy drifted'
      using errcode = '55000';
  end if;
end;
$$;

revoke insert, update, delete, truncate on table public.requests
  from service_role;

alter table public.notifications
  drop constraint notifications_profile_id_fkey,
  alter column profile_id drop not null,
  add constraint notifications_profile_id_fkey
    foreign key (profile_id) references public.profiles(id) on delete set null;

create or replace function private.enforce_notification_read_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.profile_id is null then
      raise exception 'new notifications require a recipient'
        using errcode = '23514';
    end if;
    if new.read_at is not null then
      raise exception 'new notifications must be unread'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.profile_id is not null
    and new.profile_id is null
    and row(
      new.id, new.market_id, new.source_kind, new.source_id,
      new.template_key, new.template_version, new.title, new.body,
      new.action_path, new.read_at, new.created_at
    ) is not distinct from row(
      old.id, old.market_id, old.source_kind, old.source_id,
      old.template_key, old.template_version, old.title, old.body,
      old.action_path, old.read_at, old.created_at
    ) then
    return new;
  end if;

  if old.profile_id is null then
    raise exception 'orphan notifications are immutable'
      using errcode = '55000';
  end if;

  if new is distinct from old then
    if row(
      new.id, new.profile_id, new.market_id, new.source_kind,
      new.source_id, new.template_key, new.template_version, new.title,
      new.body, new.action_path, new.created_at
    ) is distinct from row(
      old.id, old.profile_id, old.market_id, old.source_kind,
      old.source_id, old.template_key, old.template_version, old.title,
      old.body, old.action_path, old.created_at
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

create function private.enqueue_fixed_in_app_notification(
  p_event_key text,
  p_source_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
  expected_status text;
  fixed_title text;
  fixed_body text;
begin
  if p_event_key is null or p_source_id is null then
    raise exception 'invalid notification event'
      using errcode = '22023';
  end if;

  case p_event_key
    when 'vendor_request_created' then
      if not exists (
        select 1
        from public.requests request
        join public.listings listing on listing.id = request.listing_id
        join public.businesses business on business.id = request.business_id
        join public.markets market on market.id = request.market_id
        join public.guest_intents intent on intent.id = request.guest_intent_id
        where request.id = p_source_id
          and request.requester_id is not null
          and request.status = 'open'
          and request.vendor_responded_at is null
          and request.business_id = listing.business_id
          and request.market_id = listing.market_id
          and request.category_id is not distinct from listing.category_id
          and listing.status = 'active'
          and listing.published_at is not null
          and business.status = 'active'
          and business.market_id = request.market_id
          and market.is_active
          and intent.kind = 'listing_request'
          and intent.claimed_by = request.requester_id
          and intent.claimed_at is not null
          and intent.consumed_at is not null
      ) then
        raise exception 'notification source state is inconsistent: vendor request created'
          using errcode = '55000';
      end if;

      insert into public.notifications(
        profile_id, market_id, source_kind, source_id, template_key,
        template_version, title, body, action_path
      )
      select
        recipient.id,
        request.market_id,
        'listing_request',
        request.id,
        'vendor_request_created',
        1,
        'New customer request',
        'A customer sent a request for one of your listings.',
        '/vendor/requests'
      from public.requests request
      join public.listings listing on listing.id = request.listing_id
      join public.businesses business on business.id = request.business_id
      join public.markets market on market.id = request.market_id
      join public.business_memberships membership
        on membership.business_id = request.business_id
      join public.profiles recipient on recipient.id = membership.profile_id
      where request.id = p_source_id
        and request.status = 'open'
        and request.business_id = listing.business_id
        and request.market_id = listing.market_id
        and listing.status = 'active'
        and listing.published_at is not null
        and business.status = 'active'
        and business.market_id = request.market_id
        and market.is_active
        and membership.accepted_at is not null
        and membership.role in ('owner', 'manager', 'staff')
        and not recipient.is_suspended
      order by recipient.id
      on conflict (
        profile_id, source_kind, source_id, template_key, template_version
      ) do nothing;

    when 'customer_request_accepted', 'customer_request_declined' then
      expected_status := case p_event_key
        when 'customer_request_accepted' then 'accepted'
        else 'declined'
      end;
      fixed_title := case expected_status
        when 'accepted' then 'Request accepted'
        else 'Request declined'
      end;
      fixed_body := case expected_status
        when 'accepted' then
          'The vendor accepted your request. Open it to review the latest status.'
        else
          'The vendor declined your request. Open it to review the latest status.'
      end;

      if not exists (
        select 1
        from public.requests request
        join public.listings listing on listing.id = request.listing_id
        join public.businesses business on business.id = request.business_id
        join public.markets market on market.id = request.market_id
        join public.profiles recipient on recipient.id = request.requester_id
        join private.listing_request_vendor_responses response
          on response.request_id = request.id
        where request.id = p_source_id
          and request.status = expected_status
          and request.vendor_responded_at is not null
          and response.result_status = expected_status
          and response.responded_at = request.vendor_responded_at
          and request.business_id = listing.business_id
          and request.market_id = listing.market_id
          and business.status = 'active'
          and business.market_id = request.market_id
          and market.is_active
      ) then
        raise exception 'notification source state is inconsistent: customer request response'
          using errcode = '55000';
      end if;

      insert into public.notifications(
        profile_id, market_id, source_kind, source_id, template_key,
        template_version, title, body, action_path
      )
      select
        recipient.id,
        request.market_id,
        'listing_request',
        request.id,
        p_event_key,
        1,
        fixed_title,
        fixed_body,
        '/' || market.slug || '/requests/' || request.id::text
      from public.requests request
      join public.listings listing on listing.id = request.listing_id
      join public.businesses business on business.id = request.business_id
      join public.markets market on market.id = request.market_id
      join public.profiles recipient on recipient.id = request.requester_id
      join private.listing_request_vendor_responses response
        on response.request_id = request.id
      where request.id = p_source_id
        and request.status = expected_status
        and request.vendor_responded_at is not null
        and response.result_status = expected_status
        and response.responded_at = request.vendor_responded_at
        and request.business_id = listing.business_id
        and request.market_id = listing.market_id
        and business.status = 'active'
        and business.market_id = request.market_id
        and market.is_active
        and not recipient.is_suspended;

    when 'vendor_order_placed' then
      if not exists (
        select 1
        from public.orders orders
        join public.businesses business on business.id = orders.business_id
        join public.markets market on market.id = orders.market_id
        where orders.id = p_source_id
          and orders.snapshot_source = 'listing_order'
          and orders.status = 'placed'
          and orders.order_number ~ '^LO-[0-9]{6}-[0-9]{10}$'
          and business.status = 'active'
          and business.market_id = orders.market_id
          and market.is_active
          and private.is_consistent_placed_listing_order(orders.id)
      ) then
        raise exception 'notification source state is inconsistent: vendor order placed'
          using errcode = '55000';
      end if;

      insert into public.notifications(
        profile_id, market_id, source_kind, source_id, template_key,
        template_version, title, body, action_path
      )
      select
        recipient.id,
        orders.market_id,
        'listing_order',
        orders.id,
        'vendor_order_placed',
        1,
        'New order',
        'A customer placed a new order. Open it to review the details.',
        '/vendor/orders/' || orders.order_number
      from public.orders orders
      join public.businesses business on business.id = orders.business_id
      join public.markets market on market.id = orders.market_id
      join public.business_memberships membership
        on membership.business_id = orders.business_id
      join public.profiles recipient on recipient.id = membership.profile_id
      where orders.id = p_source_id
        and orders.snapshot_source = 'listing_order'
        and orders.status = 'placed'
        and business.status = 'active'
        and business.market_id = orders.market_id
        and market.is_active
        and membership.accepted_at is not null
        and membership.role in ('owner', 'manager', 'staff')
        and not recipient.is_suspended
        and private.is_consistent_placed_listing_order(orders.id)
      order by recipient.id
      on conflict (
        profile_id, source_kind, source_id, template_key, template_version
      ) do nothing;

    when 'customer_order_confirmed', 'customer_order_cancelled' then
      expected_status := case p_event_key
        when 'customer_order_confirmed' then 'confirmed'
        else 'cancelled'
      end;
      fixed_title := case expected_status
        when 'confirmed' then 'Order confirmed'
        else 'Order cancelled'
      end;
      fixed_body := case expected_status
        when 'confirmed' then
          'The vendor confirmed your order. Open it to review the latest status.'
        else
          'The vendor cancelled your order. Open it to review the latest status.'
      end;

      if not exists (
        select 1
        from public.orders orders
        join public.businesses business on business.id = orders.business_id
        join public.markets market on market.id = orders.market_id
        join public.profiles recipient on recipient.id = orders.buyer_id
        where orders.id = p_source_id
          and orders.snapshot_source = 'listing_order'
          and orders.status::text = expected_status
          and orders.vendor_decided_at is not null
          and orders.order_number ~ '^LO-[0-9]{6}-[0-9]{10}$'
          and business.status = 'active'
          and business.market_id = orders.market_id
          and market.is_active
          and private.is_consistent_terminal_listing_order(
            orders.id, expected_status, orders.vendor_decided_at, null
          )
      ) then
        raise exception 'notification source state is inconsistent: customer order response'
          using errcode = '55000';
      end if;

      insert into public.notifications(
        profile_id, market_id, source_kind, source_id, template_key,
        template_version, title, body, action_path
      )
      select
        recipient.id,
        orders.market_id,
        'listing_order',
        orders.id,
        p_event_key,
        1,
        fixed_title,
        fixed_body,
        '/' || market.slug || '/orders/' || orders.order_number
      from public.orders orders
      join public.businesses business on business.id = orders.business_id
      join public.markets market on market.id = orders.market_id
      join public.profiles recipient on recipient.id = orders.buyer_id
      where orders.id = p_source_id
        and orders.snapshot_source = 'listing_order'
        and orders.status::text = expected_status
        and orders.vendor_decided_at is not null
        and business.status = 'active'
        and business.market_id = orders.market_id
        and market.is_active
        and not recipient.is_suspended
        and private.is_consistent_terminal_listing_order(
          orders.id, expected_status, orders.vendor_decided_at, null
        );

    when 'customer_order_processing' then
      if not exists (
        select 1
        from public.order_fulfilments fulfilment
        join public.orders orders on orders.id = fulfilment.order_id
        join public.businesses business on business.id = orders.business_id
        join public.markets market on market.id = orders.market_id
        join public.profiles recipient on recipient.id = orders.buyer_id
        where fulfilment.id = p_source_id
          and fulfilment.status = 'processing'
          and orders.snapshot_source = 'listing_order'
          and orders.status = 'confirmed'
          and orders.order_number ~ '^LO-[0-9]{6}-[0-9]{10}$'
          and business.status = 'active'
          and business.market_id = orders.market_id
          and market.is_active
          and private.is_consistent_processing_listing_order(
            orders.id, fulfilment.id, fulfilment.started_at, null
          )
      ) then
        raise exception 'notification source state is inconsistent: order processing'
          using errcode = '55000';
      end if;

      insert into public.notifications(
        profile_id, market_id, source_kind, source_id, template_key,
        template_version, title, body, action_path
      )
      select
        recipient.id,
        orders.market_id,
        'listing_order_fulfilment',
        fulfilment.id,
        'customer_order_processing',
        1,
        'Order processing started',
        'The vendor started processing your order. Open it to review the latest status.',
        '/' || market.slug || '/orders/' || orders.order_number
      from public.order_fulfilments fulfilment
      join public.orders orders on orders.id = fulfilment.order_id
      join public.businesses business on business.id = orders.business_id
      join public.markets market on market.id = orders.market_id
      join public.profiles recipient on recipient.id = orders.buyer_id
      where fulfilment.id = p_source_id
        and fulfilment.status = 'processing'
        and orders.snapshot_source = 'listing_order'
        and orders.status = 'confirmed'
        and business.status = 'active'
        and business.market_id = orders.market_id
        and market.is_active
        and not recipient.is_suspended
        and private.is_consistent_processing_listing_order(
          orders.id, fulfilment.id, fulfilment.started_at, null
        );

    else
      raise exception 'invalid notification event'
        using errcode = '22023';
  end case;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

alter function private.enqueue_fixed_in_app_notification(text, uuid)
  owner to postgres;
revoke all on function private.enqueue_fixed_in_app_notification(text, uuid)
  from public, anon, authenticated, service_role;

alter function public.create_listing_request_from_intent(uuid, text)
  rename to create_listing_request_from_intent_source_boundary;
alter function public.create_listing_request_from_intent_source_boundary(uuid, text)
  set schema private;

alter function public.respond_to_listing_request(uuid, text, uuid)
  rename to respond_to_listing_request_source_boundary;
alter function public.respond_to_listing_request_source_boundary(uuid, text, uuid)
  set schema private;

alter function public.create_listing_order_from_intent(uuid)
  rename to create_listing_order_from_intent_source_boundary;
alter function public.create_listing_order_from_intent_source_boundary(uuid)
  set schema private;

alter function public.respond_to_listing_order(uuid, text, uuid)
  rename to respond_to_listing_order_source_boundary;
alter function public.respond_to_listing_order_source_boundary(uuid, text, uuid)
  set schema private;

alter function public.start_listing_order_fulfilment(uuid, uuid)
  rename to start_listing_order_fulfilment_source_boundary;
alter function public.start_listing_order_fulfilment_source_boundary(uuid, uuid)
  set schema private;

alter function private.create_listing_request_from_intent_source_boundary(uuid, text)
  owner to postgres;
alter function private.respond_to_listing_request_source_boundary(uuid, text, uuid)
  owner to postgres;
alter function private.create_listing_order_from_intent_source_boundary(uuid)
  owner to postgres;
alter function private.respond_to_listing_order_source_boundary(uuid, text, uuid)
  owner to postgres;
alter function private.start_listing_order_fulfilment_source_boundary(uuid, uuid)
  owner to postgres;

revoke all on function private.create_listing_request_from_intent_source_boundary(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.respond_to_listing_request_source_boundary(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.create_listing_order_from_intent_source_boundary(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.respond_to_listing_order_source_boundary(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.start_listing_order_fulfilment_source_boundary(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.create_listing_request_from_intent(
  p_intent_id uuid,
  p_details text
)
returns table(
  outcome text,
  retryable boolean,
  request_id uuid,
  request_number text,
  status text,
  created_at timestamptz,
  listing_title text,
  vendor_name text,
  market_slug text,
  listing_route text,
  listing_id uuid,
  requested_action text,
  details text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  response record;
begin
  select * into strict response
  from private.create_listing_request_from_intent_source_boundary(
    p_intent_id, p_details
  );

  if response.outcome = 'created' then
    if response.request_id is null then
      raise exception 'listing request creation returned no source identity';
    end if;
    perform private.enqueue_fixed_in_app_notification(
      'vendor_request_created', response.request_id
    );
  end if;

  return query select
    response.outcome,
    response.retryable,
    response.request_id,
    response.request_number,
    response.status,
    response.created_at,
    response.listing_title,
    response.vendor_name,
    response.market_slug,
    response.listing_route,
    response.listing_id,
    response.requested_action,
    response.details;
end;
$$;

create function public.respond_to_listing_request(
  p_request_id uuid,
  p_decision text,
  p_idempotency_key uuid
)
returns table(
  request_id uuid,
  outcome text,
  status text,
  vendor_responded_at timestamptz,
  updated_at timestamptz,
  retryable boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  response record;
begin
  select * into strict response
  from private.respond_to_listing_request_source_boundary(
    p_request_id, p_decision, p_idempotency_key
  );

  if response.outcome = 'transitioned' then
    if response.request_id is null or response.status not in ('accepted', 'declined') then
      raise exception 'listing request transition returned inconsistent notification state';
    end if;
    perform private.enqueue_fixed_in_app_notification(
      case response.status
        when 'accepted' then 'customer_request_accepted'
        else 'customer_request_declined'
      end,
      response.request_id
    );
  end if;

  return query select
    response.request_id,
    response.outcome,
    response.status,
    response.vendor_responded_at,
    response.updated_at,
    response.retryable;
end;
$$;

create function public.create_listing_order_from_intent(
  p_intent_id uuid
)
returns table(
  outcome text,
  retryable boolean,
  order_id uuid,
  order_number text,
  status text,
  created_at timestamptz,
  placed_at timestamptz,
  vendor_decided_at timestamptz,
  fulfilment_id uuid,
  fulfilment_status text,
  fulfilment_started_at timestamptz,
  fulfilment_updated_at timestamptz,
  business_id uuid,
  vendor_name text,
  market_slug text,
  listing_id uuid,
  listing_route text,
  listing_title text,
  quantity integer,
  currency_code text,
  unit_price_minor bigint,
  total_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  response record;
begin
  select * into strict response
  from private.create_listing_order_from_intent_source_boundary(p_intent_id);

  if response.outcome = 'created' then
    if response.order_id is null then
      raise exception 'listing order creation returned no source identity';
    end if;
    perform private.enqueue_fixed_in_app_notification(
      'vendor_order_placed', response.order_id
    );
  end if;

  return query select
    response.outcome,
    response.retryable,
    response.order_id,
    response.order_number,
    response.status,
    response.created_at,
    response.placed_at,
    response.vendor_decided_at,
    response.fulfilment_id,
    response.fulfilment_status,
    response.fulfilment_started_at,
    response.fulfilment_updated_at,
    response.business_id,
    response.vendor_name,
    response.market_slug,
    response.listing_id,
    response.listing_route,
    response.listing_title,
    response.quantity,
    response.currency_code,
    response.unit_price_minor,
    response.total_minor;
end;
$$;

create function public.respond_to_listing_order(
  p_order_id uuid,
  p_decision text,
  p_idempotency_key uuid
)
returns table(
  order_id uuid,
  outcome text,
  status text,
  vendor_decided_at timestamptz,
  updated_at timestamptz,
  retryable boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  response record;
begin
  select * into strict response
  from private.respond_to_listing_order_source_boundary(
    p_order_id, p_decision, p_idempotency_key
  );

  if response.outcome = 'transitioned' then
    if response.order_id is null or response.status not in ('confirmed', 'cancelled') then
      raise exception 'listing order transition returned inconsistent notification state';
    end if;
    perform private.enqueue_fixed_in_app_notification(
      case response.status
        when 'confirmed' then 'customer_order_confirmed'
        else 'customer_order_cancelled'
      end,
      response.order_id
    );
  end if;

  return query select
    response.order_id,
    response.outcome,
    response.status,
    response.vendor_decided_at,
    response.updated_at,
    response.retryable;
end;
$$;

create function public.start_listing_order_fulfilment(
  p_order_id uuid,
  p_idempotency_key uuid
)
returns table(
  order_id uuid,
  outcome text,
  order_status text,
  fulfilment_id uuid,
  fulfilment_status text,
  fulfilment_started_at timestamptz,
  fulfilment_updated_at timestamptz,
  retryable boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  response record;
begin
  select * into strict response
  from private.start_listing_order_fulfilment_source_boundary(
    p_order_id, p_idempotency_key
  );

  if response.outcome = 'started' then
    if response.fulfilment_id is null then
      raise exception 'listing order fulfilment returned no source identity';
    end if;
    perform private.enqueue_fixed_in_app_notification(
      'customer_order_processing', response.fulfilment_id
    );
  end if;

  return query select
    response.order_id,
    response.outcome,
    response.order_status,
    response.fulfilment_id,
    response.fulfilment_status,
    response.fulfilment_started_at,
    response.fulfilment_updated_at,
    response.retryable;
end;
$$;

alter function public.create_listing_request_from_intent(uuid, text)
  owner to postgres;
alter function public.respond_to_listing_request(uuid, text, uuid)
  owner to postgres;
alter function public.create_listing_order_from_intent(uuid)
  owner to postgres;
alter function public.respond_to_listing_order(uuid, text, uuid)
  owner to postgres;
alter function public.start_listing_order_fulfilment(uuid, uuid)
  owner to postgres;

revoke all on function public.create_listing_request_from_intent(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.respond_to_listing_request(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_listing_order_from_intent(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.respond_to_listing_order(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.start_listing_order_fulfilment(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.create_listing_request_from_intent(uuid, text)
  to authenticated;
grant execute on function public.respond_to_listing_request(uuid, text, uuid)
  to authenticated;
grant execute on function public.create_listing_order_from_intent(uuid)
  to authenticated;
grant execute on function public.respond_to_listing_order(uuid, text, uuid)
  to authenticated;
grant execute on function public.start_listing_order_fulfilment(uuid, uuid)
  to authenticated;

do $$
declare
  actual_names text[];
  function_record pg_catalog.pg_proc%rowtype;
  function_signature text;
  privilege_name text;
  role_name text;
begin
  foreach function_signature in array array[
    'private.enqueue_fixed_in_app_notification(text,uuid)',
    'private.create_listing_request_from_intent_source_boundary(uuid,text)',
    'private.respond_to_listing_request_source_boundary(uuid,text,uuid)',
    'private.create_listing_order_from_intent_source_boundary(uuid)',
    'private.respond_to_listing_order_source_boundary(uuid,text,uuid)',
    'private.start_listing_order_fulfilment_source_boundary(uuid,uuid)'
  ] loop
    if pg_catalog.to_regprocedure(function_signature) is null then
      raise exception 'notification producer function surface drifted: % absent',
        function_signature using errcode = '55000';
    end if;
    select routine_record.* into strict function_record
    from pg_catalog.pg_proc routine_record
    where routine_record.oid = function_signature::pg_catalog.regprocedure;
    if pg_catalog.pg_get_userbyid(function_record.proowner) <> 'postgres'
      or not function_record.prosecdef
      or function_record.prokind <> 'f'
      or not coalesce(function_record.proconfig, array[]::text[])
        @> array['search_path=""']::text[]
      or pg_catalog.has_function_privilege(
        'anon', function_signature, 'execute'
      )
      or pg_catalog.has_function_privilege(
        'authenticated', function_signature, 'execute'
      )
      or pg_catalog.has_function_privilege(
        'service_role', function_signature, 'execute'
      )
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
      ) then
      raise exception 'notification producer function acl drifted: %',
        function_signature using errcode = '55000';
    end if;
  end loop;

  foreach function_signature in array array[
    'public.create_listing_request_from_intent(uuid,text)',
    'public.respond_to_listing_request(uuid,text,uuid)',
    'public.create_listing_order_from_intent(uuid)',
    'public.respond_to_listing_order(uuid,text,uuid)',
    'public.start_listing_order_fulfilment(uuid,uuid)'
  ] loop
    if pg_catalog.to_regprocedure(function_signature) is null then
      raise exception 'notification producer function surface drifted: % absent',
        function_signature using errcode = '55000';
    end if;
    select routine_record.* into strict function_record
    from pg_catalog.pg_proc routine_record
    where routine_record.oid = function_signature::pg_catalog.regprocedure;
    if pg_catalog.pg_get_userbyid(function_record.proowner) <> 'postgres'
      or not function_record.prosecdef
      or function_record.prokind <> 'f'
      or not coalesce(function_record.proconfig, array[]::text[])
        @> array['search_path=""']::text[]
      or not pg_catalog.has_function_privilege(
        'authenticated', function_signature, 'execute'
      )
      or pg_catalog.has_function_privilege('anon', function_signature, 'execute')
      or pg_catalog.has_function_privilege(
        'service_role', function_signature, 'execute'
      )
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
      ) then
      raise exception 'notification producer function acl drifted: %',
        function_signature using errcode = '55000';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_attribute attribute_record
    where attribute_record.attrelid = 'public.notifications'::pg_catalog.regclass
      and attribute_record.attname = 'profile_id'
      and attribute_record.attnotnull
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.notifications'::pg_catalog.regclass
      and constraint_record.conname = 'notifications_profile_id_fkey'
      and constraint_record.confrelid = 'public.profiles'::pg_catalog.regclass
      and constraint_record.confdeltype = 'n'
      and not constraint_record.condeferrable
      and constraint_record.convalidated
  ) then
    raise exception 'notification realtime deletion safety drifted: nullable set-null FK absent'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables publication_record
    where publication_record.pubname = 'supabase_realtime'
      and publication_record.schemaname = 'public'
      and publication_record.tablename = 'notifications'
  ) or not exists (
    select 1
    from pg_catalog.pg_class relation_record
    where relation_record.oid = 'public.notifications'::pg_catalog.regclass
      and relation_record.relrowsecurity
      and relation_record.relforcerowsecurity
      and relation_record.relreplident <> 'f'
      and pg_catalog.pg_get_userbyid(relation_record.relowner) = 'postgres'
  ) or (
    select count(*)
    from pg_catalog.pg_policy policy_record
    where policy_record.polrelid = 'public.notifications'::pg_catalog.regclass
      and policy_record.polname = 'notifications_active_self_select'
      and policy_record.polpermissive
      and policy_record.polcmd = 'r'
      and policy_record.polroles = array[(
        select role_record.oid from pg_catalog.pg_roles role_record
        where role_record.rolname = 'authenticated'
      )]::oid[]
      and policy_record.polwithcheck is null
      and pg_catalog.pg_get_expr(
        policy_record.polqual, policy_record.polrelid
      ) = '((profile_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_current_profile_active() AS is_current_profile_active))'
  ) <> 1 or (
    select count(*) from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'notifications'
  ) <> 1 then
    raise exception 'notification inbox rls surface drifted'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.notifications'::pg_catalog.regclass
      and trigger_record.tgname = 'notifications_enforce_read_state'
      and trigger_record.tgfoid =
        'private.enforce_notification_read_state()'::pg_catalog.regprocedure
      and trigger_record.tgenabled = 'A'
      and not trigger_record.tgisinternal
  ) <> 1 or pg_catalog.pg_get_functiondef(
    'private.enforce_notification_read_state()'::pg_catalog.regprocedure
  ) !~ 'old[.]profile_id is not null[[:space:]]+and new[.]profile_id is null'
    or pg_catalog.pg_get_functiondef(
      'private.enforce_notification_read_state()'::pg_catalog.regprocedure
    ) !~ 'orphan notifications are immutable' then
    raise exception 'notification realtime deletion safety drifted: immutable orphan guard absent'
      using errcode = '55000';
  end if;

  foreach role_name in array array['public', 'anon', 'authenticated', 'service_role'] loop
    foreach privilege_name in array array[
      'insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'maintain'
    ] loop
      if pg_catalog.has_table_privilege(
        role_name, 'public.notifications', privilege_name
      ) then
        raise exception 'notification producer function acl drifted: inbox % retained %',
          role_name, privilege_name using errcode = '55000';
      end if;
    end loop;
  end loop;

  if pg_catalog.has_table_privilege(
      'service_role', 'public.requests', 'insert'
    ) or pg_catalog.has_table_privilege(
      'service_role', 'public.requests', 'update'
    ) or pg_catalog.has_table_privilege(
      'service_role', 'public.requests', 'delete'
    ) or pg_catalog.has_table_privilege(
      'service_role', 'public.requests', 'truncate'
    ) then
    raise exception 'notification source dml acl drifted: service_role revoke ineffective'
      using errcode = '55000';
  end if;

  if pg_catalog.has_column_privilege(
      'authenticated', 'public.notifications', 'source_kind', 'select'
    ) or pg_catalog.has_column_privilege(
      'authenticated', 'public.notifications', 'source_id', 'select'
    ) then
    raise exception 'notification producer function acl drifted: hidden inbox identity exposed'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(trigger_record.tgname order by trigger_record.tgname)
  into actual_names
  from pg_catalog.pg_trigger trigger_record
  where trigger_record.tgrelid in (
    'public.requests'::pg_catalog.regclass,
    'public.orders'::pg_catalog.regclass,
    'public.order_fulfilments'::pg_catalog.regclass
  )
    and not trigger_record.tgisinternal
    and trigger_record.tgname ~ 'notification';
  if actual_names is not null then
    raise exception 'notification source mutation guard surface drifted: producer trigger installed'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'private'
      and policy_record.tablename = 'notification_deliveries'
  ) or exists (
    select 1 from private.notification_deliveries
  ) or (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'private.notification_deliveries'::pg_catalog.regclass
      and trigger_record.tgfoid =
        'private.prevent_dormant_notification_delivery_mutation()'::pg_catalog.regprocedure
      and trigger_record.tgenabled = 'A'
      and not trigger_record.tgisinternal
  ) <> 2 then
    raise exception 'notification delivery dormancy drifted'
      using errcode = '55000';
  end if;
end;
$$;

comment on function private.enqueue_fixed_in_app_notification(text, uuid) is
  'Private fixed-copy in-app producer. Recipients, source linkage, market, copy, and routes are derived from authoritative completed source state.';
comment on column public.notifications.profile_id is
  'Non-null for every producer insert. Profile deletion sets this to null so Realtime emits no unfilterable DELETE; orphan rows remain RLS-inaccessible and immutable.';

commit;
