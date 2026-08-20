-- Temporary read-only diagnostic to inspect live RLS policy/grant state on
-- tuition_payments vs tuition_plans without a direct Postgres connection
-- (this environment has no IPv6 egress, which the pooler/direct host both
-- require). Dropped by the very next migration once the diagnosis is done.
create or replace function _debug_rls_check()
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'policies', (
      select jsonb_agg(jsonb_build_object(
        'table', tablename, 'policy', policyname, 'permissive', permissive,
        'roles', roles, 'cmd', cmd, 'qual', qual, 'with_check', with_check
      ))
      from pg_policies
      where schemaname = 'public' and tablename in ('tuition_payments','tuition_plans')
    ),
    'rls_enabled', (
      select jsonb_agg(jsonb_build_object('table', relname, 'rowsecurity', relrowsecurity, 'forcerowsecurity', relforcerowsecurity))
      from pg_class
      where relname in ('tuition_payments','tuition_plans') and relnamespace = 'public'::regnamespace
    ),
    'grants', (
      select jsonb_agg(jsonb_build_object('table', table_name, 'grantee', grantee, 'privilege', privilege_type))
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name in ('tuition_payments','tuition_plans')
        and grantee in ('authenticated','anon','service_role')
    )
  );
$$;

revoke all on function _debug_rls_check() from public, anon, authenticated;
grant execute on function _debug_rls_check() to service_role;
