-- LocalHub runtime hardening for the authoritative production project.
-- Keep the application rate-limit ledger inaccessible even if grants drift,
-- and enable Realtime only for operational state that the product consumes.

alter table public.auth_rate_limits enable row level security;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'orders',
    'order_status_events',
    'fulfilment_events',
    'notifications'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        target_table
      );
    end if;
  end loop;
end;
$$;
