-- When Parents Marital Status isn't Married, each parent may independently
-- still be single or have remarried. If remarried, we capture the new
-- spouse's name and unlock a "step" grandparents panel (that spouse's own
-- parents), mirroring the existing paternal/maternal grandparent columns.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS father_current_status        text DEFAULT 'Single',
  ADD COLUMN IF NOT EXISTS father_stepmother_first_name text,
  ADD COLUMN IF NOT EXISTS father_stepmother_last_name  text,

  ADD COLUMN IF NOT EXISTS mother_current_status        text DEFAULT 'Single',
  ADD COLUMN IF NOT EXISTS mother_stepfather_first_name text,
  ADD COLUMN IF NOT EXISTS mother_stepfather_last_name  text,

  ADD COLUMN IF NOT EXISTS step_paternal_grandfather_name        text,
  ADD COLUMN IF NOT EXISTS step_paternal_grandmother_name        text,
  ADD COLUMN IF NOT EXISTS step_paternal_grandfather_cell        text,
  ADD COLUMN IF NOT EXISTS step_paternal_grandmother_cell        text,
  ADD COLUMN IF NOT EXISTS step_paternal_grandfather_email       text,
  ADD COLUMN IF NOT EXISTS step_paternal_grandmother_email       text,
  ADD COLUMN IF NOT EXISTS step_paternal_grandparents_address    text,
  ADD COLUMN IF NOT EXISTS step_paternal_grandparents_home_phone text,

  ADD COLUMN IF NOT EXISTS step_maternal_grandfather_name        text,
  ADD COLUMN IF NOT EXISTS step_maternal_grandmother_name        text,
  ADD COLUMN IF NOT EXISTS step_maternal_grandfather_cell        text,
  ADD COLUMN IF NOT EXISTS step_maternal_grandmother_cell        text,
  ADD COLUMN IF NOT EXISTS step_maternal_grandfather_email       text,
  ADD COLUMN IF NOT EXISTS step_maternal_grandmother_email       text,
  ADD COLUMN IF NOT EXISTS step_maternal_grandparents_address    text,
  ADD COLUMN IF NOT EXISTS step_maternal_grandparents_home_phone text;
