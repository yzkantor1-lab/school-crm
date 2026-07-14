ALTER TABLE tuition_plans
  ADD COLUMN IF NOT EXISTS yearly_amount        numeric,
  ADD COLUMN IF NOT EXISTS plan_came_semester   text,   -- '1', '2', or '3'
  ADD COLUMN IF NOT EXISTS plan_left_semester   text;   -- '1', '2', or '3'; null = full year (through Sem 3)
