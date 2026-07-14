ALTER TABLE tuition_plans
  ADD COLUMN IF NOT EXISTS preferred_payment_method text,
  ADD COLUMN IF NOT EXISTS reminder_date            date,
  ADD COLUMN IF NOT EXISTS reminder_note            text;
