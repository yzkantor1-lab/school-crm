ALTER TABLE students
  ADD COLUMN IF NOT EXISTS spouse_first_name    text,
  ADD COLUMN IF NOT EXISTS spouse_last_name     text,
  ADD COLUMN IF NOT EXISTS spouse_phone         text,
  ADD COLUMN IF NOT EXISTS spouse_email         text,
  ADD COLUMN IF NOT EXISTS inlaw_parents_title  text,
  ADD COLUMN IF NOT EXISTS inlaw_father_name    text,
  ADD COLUMN IF NOT EXISTS inlaw_father_cell    text,
  ADD COLUMN IF NOT EXISTS inlaw_father_email   text,
  ADD COLUMN IF NOT EXISTS inlaw_mother_name    text,
  ADD COLUMN IF NOT EXISTS inlaw_mother_cell    text,
  ADD COLUMN IF NOT EXISTS inlaw_mother_email   text,
  ADD COLUMN IF NOT EXISTS inlaw_address        text;
