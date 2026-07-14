-- Distinguish regular tuition payments from occasional donation payments
-- recorded against a family, so donations don't count toward tuition balance owed.

ALTER TABLE tuition_payments
  ADD COLUMN IF NOT EXISTS payment_type text DEFAULT 'tuition' CHECK (payment_type IN ('tuition', 'donation'));
