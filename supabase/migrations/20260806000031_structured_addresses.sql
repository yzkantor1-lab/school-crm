-- Structured address fields (street/city/state/zip/country) for every
-- address group in the student form, replacing free-text entry with
-- proper fields + optional Google Places autocomplete. The original
-- single-line columns (address, paternal_grandparents_address,
-- personal_address, etc.) stay in place — the app now derives them from
-- these structured fields on save, so anything still reading the old
-- column (tuition statements, donor/alumni pages, PDFs) keeps working.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS address_street  text,
  ADD COLUMN IF NOT EXISTS address_city    text,
  ADD COLUMN IF NOT EXISTS address_state   text,
  ADD COLUMN IF NOT EXISTS address_zip     text,
  ADD COLUMN IF NOT EXISTS address_country text,

  ADD COLUMN IF NOT EXISTS paternal_grandparents_street  text,
  ADD COLUMN IF NOT EXISTS paternal_grandparents_city    text,
  ADD COLUMN IF NOT EXISTS paternal_grandparents_state   text,
  ADD COLUMN IF NOT EXISTS paternal_grandparents_zip     text,
  ADD COLUMN IF NOT EXISTS paternal_grandparents_country text,

  ADD COLUMN IF NOT EXISTS maternal_grandparents_street  text,
  ADD COLUMN IF NOT EXISTS maternal_grandparents_city    text,
  ADD COLUMN IF NOT EXISTS maternal_grandparents_state   text,
  ADD COLUMN IF NOT EXISTS maternal_grandparents_zip     text,
  ADD COLUMN IF NOT EXISTS maternal_grandparents_country text,

  ADD COLUMN IF NOT EXISTS step_paternal_grandparents_street  text,
  ADD COLUMN IF NOT EXISTS step_paternal_grandparents_city    text,
  ADD COLUMN IF NOT EXISTS step_paternal_grandparents_state   text,
  ADD COLUMN IF NOT EXISTS step_paternal_grandparents_zip     text,
  ADD COLUMN IF NOT EXISTS step_paternal_grandparents_country text,

  ADD COLUMN IF NOT EXISTS step_maternal_grandparents_street  text,
  ADD COLUMN IF NOT EXISTS step_maternal_grandparents_city    text,
  ADD COLUMN IF NOT EXISTS step_maternal_grandparents_state   text,
  ADD COLUMN IF NOT EXISTS step_maternal_grandparents_zip     text,
  ADD COLUMN IF NOT EXISTS step_maternal_grandparents_country text,

  ADD COLUMN IF NOT EXISTS inlaw_street  text,
  ADD COLUMN IF NOT EXISTS inlaw_city    text,
  ADD COLUMN IF NOT EXISTS inlaw_state   text,
  ADD COLUMN IF NOT EXISTS inlaw_zip     text,
  ADD COLUMN IF NOT EXISTS inlaw_country text,

  ADD COLUMN IF NOT EXISTS personal_street  text,
  ADD COLUMN IF NOT EXISTS personal_city    text,
  ADD COLUMN IF NOT EXISTS personal_state   text,
  ADD COLUMN IF NOT EXISTS personal_zip     text,
  ADD COLUMN IF NOT EXISTS personal_country text;
