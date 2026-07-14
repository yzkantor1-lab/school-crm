ALTER TABLE students
  ADD COLUMN IF NOT EXISTS address       text,
  ADD COLUMN IF NOT EXISTS home_phone    text,
  ADD COLUMN IF NOT EXISTS father_cell   text,
  ADD COLUMN IF NOT EXISTS mother_cell   text,
  ADD COLUMN IF NOT EXISTS father_email  text,
  ADD COLUMN IF NOT EXISTS mother_email  text,
  ADD COLUMN IF NOT EXISTS parents_title text,
  ADD COLUMN IF NOT EXISTS came_semester text;
