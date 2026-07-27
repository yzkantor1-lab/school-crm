-- Sola Payments integration: client sync, saved payment methods, recurring
-- schedules/payment plans, and a transaction audit log. Actual money owed/paid
-- bookkeeping still lives in the existing tuition_payments/donations tables —
-- these tables only ever store Sola's own reference IDs plus a staff-entered
-- display label, never card/bank account numbers.

ALTER TABLE students ADD COLUMN IF NOT EXISTS sola_customer_id text;
ALTER TABLE donors   ADD COLUMN IF NOT EXISTS sola_customer_id text;

CREATE TABLE payment_methods (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES students(id),
  donor_id uuid REFERENCES donors(id),
  sola_payment_method_id text NOT NULL,
  method_type text NOT NULL CHECK (method_type IN ('card', 'ach')),
  label text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  CHECK ((student_id IS NOT NULL) <> (donor_id IS NOT NULL))
);

CREATE TABLE payment_schedules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES students(id),
  donor_id uuid REFERENCES donors(id),
  payment_method_id uuid REFERENCES payment_methods(id),
  sola_schedule_id text NOT NULL,
  purpose text NOT NULL,
  amount numeric NOT NULL,
  interval_type text NOT NULL CHECK (interval_type IN ('day', 'week', 'month', 'year')),
  interval_count integer NOT NULL DEFAULT 1,
  total_payments integer,
  start_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at timestamptz DEFAULT now(),
  CHECK ((student_id IS NOT NULL) <> (donor_id IS NOT NULL))
);

CREATE TABLE payment_transactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES students(id),
  donor_id uuid REFERENCES donors(id),
  payment_method_id uuid REFERENCES payment_methods(id),
  schedule_id uuid REFERENCES payment_schedules(id),
  sola_ref_num text,
  amount numeric NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL CHECK (status IN ('approved', 'declined', 'error')),
  is_test boolean NOT NULL DEFAULT true,
  error_message text,
  raw_response jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE payment_methods      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_schedules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

-- Same trust model as tuition_payments/donations: any authenticated staff
-- member (this app has one shared authenticated role, no per-user scoping
-- elsewhere either) can read/write. Only the raw Sola API key itself
-- (payment_settings) is locked to service-role-only.
CREATE POLICY "authenticated_all_payment_methods" ON payment_methods
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all_payment_schedules" ON payment_schedules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all_payment_transactions" ON payment_transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
