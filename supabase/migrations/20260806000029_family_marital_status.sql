-- Marital status for the parents and each set of grandparents — defaults to
-- 'Married' (the assumption), with Separated/Divorced/Widowed as the other
-- options, per school request.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS parents_marital_status              text DEFAULT 'Married',
  ADD COLUMN IF NOT EXISTS paternal_grandparents_marital_status text DEFAULT 'Married',
  ADD COLUMN IF NOT EXISTS maternal_grandparents_marital_status text DEFAULT 'Married';
