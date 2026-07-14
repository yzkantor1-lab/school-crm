-- Building Fund: a separate charge on the tuition plan, tracked independently
-- from tuition itself (own owed/paid amounts), while still counting toward
-- the family's total balance due.

ALTER TABLE tuition_plans
  ADD COLUMN IF NOT EXISTS building_fund_amount numeric(10,2) DEFAULT 0;

ALTER TABLE tuition_payments
  DROP CONSTRAINT IF EXISTS tuition_payments_payment_type_check;

ALTER TABLE tuition_payments
  ADD CONSTRAINT tuition_payments_payment_type_check
  CHECK (payment_type IN ('tuition', 'donation', 'building_fund'));
