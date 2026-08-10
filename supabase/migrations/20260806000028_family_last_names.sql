-- Optional last-name overrides for family members who don't share the
-- student's surname (divorced/remarried mother, grandmothers on either
-- side). Null/blank means "same as student" — only set when it differs.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS mother_last_name              text,
  ADD COLUMN IF NOT EXISTS paternal_grandmother_last_name text,
  ADD COLUMN IF NOT EXISTS maternal_grandmother_last_name text;
