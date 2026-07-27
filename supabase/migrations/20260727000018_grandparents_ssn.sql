ALTER TABLE students
  ADD COLUMN IF NOT EXISTS ssn text,

  ADD COLUMN IF NOT EXISTS paternal_grandfather_name        text,
  ADD COLUMN IF NOT EXISTS paternal_grandmother_name        text,
  ADD COLUMN IF NOT EXISTS paternal_grandparents_address    text,
  ADD COLUMN IF NOT EXISTS paternal_grandparents_home_phone text,
  ADD COLUMN IF NOT EXISTS paternal_grandfather_cell        text,
  ADD COLUMN IF NOT EXISTS paternal_grandmother_cell        text,
  ADD COLUMN IF NOT EXISTS paternal_grandfather_email       text,
  ADD COLUMN IF NOT EXISTS paternal_grandmother_email       text,

  ADD COLUMN IF NOT EXISTS maternal_grandfather_name        text,
  ADD COLUMN IF NOT EXISTS maternal_grandmother_name        text,
  ADD COLUMN IF NOT EXISTS maternal_grandparents_address    text,
  ADD COLUMN IF NOT EXISTS maternal_grandparents_home_phone text,
  ADD COLUMN IF NOT EXISTS maternal_grandfather_cell        text,
  ADD COLUMN IF NOT EXISTS maternal_grandmother_cell        text,
  ADD COLUMN IF NOT EXISTS maternal_grandfather_email       text,
  ADD COLUMN IF NOT EXISTS maternal_grandmother_email       text;
