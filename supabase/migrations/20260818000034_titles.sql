-- Title (Rabbi & Mrs. / Mr. & Mrs. / etc.) for parents, each grandparent
-- group, and donors.
--
-- Parents and blood grandparents (paternal/maternal) already track marital
-- status: when Married, the existing shared *_title-style field covers the
-- couple; when not, each person needs their own title instead, since they
-- may no longer be addressed as a couple (or may have remarried into a new
-- one — same dropdown either way, staff just picks the option that fits).
-- Step grandparents have no marital status tracked (always presumed a
-- couple), so they only need one shared field each.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS father_title text,
  ADD COLUMN IF NOT EXISTS mother_title text,

  ADD COLUMN IF NOT EXISTS paternal_grandparents_title text,
  ADD COLUMN IF NOT EXISTS paternal_grandfather_title  text,
  ADD COLUMN IF NOT EXISTS paternal_grandmother_title  text,

  ADD COLUMN IF NOT EXISTS maternal_grandparents_title text,
  ADD COLUMN IF NOT EXISTS maternal_grandfather_title  text,
  ADD COLUMN IF NOT EXISTS maternal_grandmother_title  text,

  ADD COLUMN IF NOT EXISTS step_paternal_grandparents_title text,
  ADD COLUMN IF NOT EXISTS step_maternal_grandparents_title text;

ALTER TABLE donors
  ADD COLUMN IF NOT EXISTS title text;
