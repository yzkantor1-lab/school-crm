-- Tuition plans and payments linked to students

CREATE TABLE IF NOT EXISTS tuition_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year text,
  total_amount numeric(10,2),
  payment_structure text CHECK (payment_structure IN ('monthly','quarterly','semester','annual')),
  payment_amount numeric(10,2),
  payment_day integer CHECK (payment_day >= 1 AND payment_day <= 31),
  start_date date,
  end_date date,
  status text DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  discount_amount numeric(10,2) DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tuition_plans_student_id ON tuition_plans(student_id);

CREATE TABLE IF NOT EXISTS tuition_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tuition_plan_id uuid NOT NULL REFERENCES tuition_plans(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount numeric(10,2),
  payment_date date,
  due_date date,
  status text DEFAULT 'pending' CHECK (status IN ('paid','pending','overdue','waived')),
  payment_method text,
  transaction_id text,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tuition_payments_plan_id ON tuition_payments(tuition_plan_id);
CREATE INDEX IF NOT EXISTS idx_tuition_payments_student_id ON tuition_payments(student_id);
CREATE INDEX IF NOT EXISTS idx_tuition_payments_status ON tuition_payments(status);
