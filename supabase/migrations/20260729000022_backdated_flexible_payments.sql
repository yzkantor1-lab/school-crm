-- Backdated payment recording + flexible/partial/forgiven payments across all
-- three fee types (tuition, building fund, registration fee).
--
-- payment_date already exists on tuition_payments, separate from created_at,
-- and the UI never restricted it to today — this migration is about widening
-- the table to also carry registration fee payments (previously tracked only
-- as flat status/amount/paid_date columns on students, with no history and
-- no partial support) and adding 'partial'/'forgiven' statuses so a single
-- charge can be settled across multiple dates/amounts, or written off.

-- Registration fee payments aren't tied to any tuition plan/academic year,
-- so tuition_plan_id must become optional.
ALTER TABLE tuition_payments
  ALTER COLUMN tuition_plan_id DROP NOT NULL;

ALTER TABLE tuition_payments
  DROP CONSTRAINT IF EXISTS tuition_payments_payment_type_check;
ALTER TABLE tuition_payments
  ADD CONSTRAINT tuition_payments_payment_type_check
  CHECK (payment_type IN ('tuition', 'donation', 'building_fund', 'registration_fee'));

ALTER TABLE tuition_payments
  DROP CONSTRAINT IF EXISTS tuition_payments_status_check;
ALTER TABLE tuition_payments
  ADD CONSTRAINT tuition_payments_status_check
  CHECK (status IN ('paid', 'pending', 'overdue', 'waived', 'partial', 'forgiven'));

-- Which billing month (stored as that month's first day) a tuition payment
-- is being applied toward, for plans billed with the yearly/monthly
-- proration breakdown. Lets the "unpaid months" backfill view know which
-- past months are already covered, independent of payment_date — a payment
-- made in December can still be applied to November's charge.
ALTER TABLE tuition_payments
  ADD COLUMN IF NOT EXISTS period_month date;

CREATE INDEX IF NOT EXISTS idx_tuition_payments_period_month ON tuition_payments(period_month);
CREATE INDEX IF NOT EXISTS idx_tuition_payments_payment_type ON tuition_payments(payment_type);

-- Preserve existing registration fee status/paid-date as real payment
-- history rows, since the Tuition page now derives registration fee
-- balance/status from tuition_payments the same way it already does for
-- building fund, instead of trusting the flat student columns.
INSERT INTO tuition_payments (student_id, tuition_plan_id, amount, payment_date, status, payment_type, notes)
SELECT
  id,
  NULL,
  COALESCE(registration_fee_amount, 250),
  COALESCE(registration_fee_paid_date, created_at::date),
  CASE WHEN registration_fee_status = 'waived' THEN 'forgiven' ELSE 'paid' END,
  'registration_fee',
  'Backfilled from registration_fee_status during payments-table migration'
FROM students
WHERE registration_fee_status IN ('paid', 'waived');
