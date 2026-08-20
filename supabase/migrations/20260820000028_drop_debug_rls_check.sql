-- Cleanup: drops the temporary diagnostic from 20260820000027, whose job is
-- done (confirmed tuition_payments/tuition_plans RLS policies and grants
-- are identical and correctly configured — no drift).
drop function if exists _debug_rls_check();
