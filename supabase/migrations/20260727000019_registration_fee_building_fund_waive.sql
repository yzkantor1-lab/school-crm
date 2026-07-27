-- Building Fund can now be waived outright (existing incremental-payment
-- tracking is unaffected — this only zeroes the charge when set).
ALTER TABLE tuition_plans
  ADD COLUMN IF NOT EXISTS building_fund_waived boolean NOT NULL DEFAULT false;

-- One-time $250 registration fee, tracked on the student directly (not tied
-- to any tuition plan/year). No DB default on status/amount — existing
-- students should stay untouched (nothing to pay) unless explicitly added
-- via the app; only newly-created students get 'pending'/250 set by the app.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS registration_fee_status text CHECK (registration_fee_status IN ('pending','paid','waived')),
  ADD COLUMN IF NOT EXISTS registration_fee_amount numeric,
  ADD COLUMN IF NOT EXISTS registration_fee_paid_date date;
