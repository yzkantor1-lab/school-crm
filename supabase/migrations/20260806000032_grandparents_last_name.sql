-- The grandparents' own family surname (same idea as the student's
-- First/Last Name split) — distinct from paternal_grandmother_last_name /
-- maternal_grandmother_last_name, which capture only the grandmother's
-- personal exception (her own divorce/remarriage/widowhood). This is the
-- baseline that exception compares against, not the student's last name.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS paternal_grandparents_last_name text,
  ADD COLUMN IF NOT EXISTS maternal_grandparents_last_name text;
