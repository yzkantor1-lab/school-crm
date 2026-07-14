ALTER TABLE students
  ADD COLUMN IF NOT EXISTS personal_phone   text,
  ADD COLUMN IF NOT EXISTS personal_address text,
  ADD COLUMN IF NOT EXISTS marital_status   text;
