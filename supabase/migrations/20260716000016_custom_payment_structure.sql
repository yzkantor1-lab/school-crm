-- Widen the payment_structure check constraint to allow a 'custom' option
-- (e.g. "3 Lump Sums", "1 Lump Sum") with free text stored separately, since
-- the constraint's actual name isn't guaranteed (it was declared inline).
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'tuition_plans'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%payment_structure%'
  LOOP
    EXECUTE format('ALTER TABLE tuition_plans DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE tuition_plans
  ADD CONSTRAINT tuition_plans_payment_structure_check
  CHECK (payment_structure IN ('monthly','quarterly','semester','annual','custom'));

ALTER TABLE tuition_plans
  ADD COLUMN IF NOT EXISTS payment_structure_custom text;
