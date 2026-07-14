-- Fundraising module: donors, donations, pledges, recurring donations, expenses, donor settings

-- donors
CREATE TABLE IF NOT EXISTS donors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone_number text,
  address text,
  category text DEFAULT 'General',
  relationship text DEFAULT 'Other',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_donors_name ON donors(name);

ALTER TABLE donors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_donors" ON donors FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- donations
CREATE TABLE IF NOT EXISTS donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id uuid NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  donation_method text NOT NULL,
  donation_date date NOT NULL DEFAULT CURRENT_DATE,
  purpose text NOT NULL,
  notes text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_donations_donor_id ON donations(donor_id);
CREATE INDEX IF NOT EXISTS idx_donations_date ON donations(donation_date);
CREATE INDEX IF NOT EXISTS idx_donations_archived ON donations(archived);

ALTER TABLE donations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_donations" ON donations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- pledges
CREATE TABLE IF NOT EXISTS pledges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id uuid NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  amount_paid numeric(10,2) NOT NULL DEFAULT 0,
  pledge_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  purpose text,
  fulfilled boolean NOT NULL DEFAULT false,
  fulfilled_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE pledges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_pledges" ON pledges FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- pledge_payments
CREATE TABLE IF NOT EXISTS pledge_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pledge_id uuid NOT NULL REFERENCES pledges(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL DEFAULT 'Cash',
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE pledge_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_pledge_payments" ON pledge_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- recurring_donations
CREATE TABLE IF NOT EXISTS recurring_donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id uuid NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  frequency text NOT NULL DEFAULT 'monthly',
  start_date date NOT NULL,
  end_date date,
  total_months integer,
  months_completed integer DEFAULT 0,
  day_of_month integer NOT NULL DEFAULT 1,
  donation_method text NOT NULL DEFAULT 'Credit card',
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE recurring_donations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_recurring_donations" ON recurring_donations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- expenses
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  category text NOT NULL,
  description text NOT NULL,
  amount numeric(10,2) NOT NULL,
  vendor text,
  payment_method text NOT NULL DEFAULT 'Cash',
  receipt_url text,
  notes text,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_archived ON expenses(archived);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_expenses" ON expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- donor_settings: configurable dropdown options for the fundraising module
CREATE TABLE IF NOT EXISTS donor_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_categories jsonb DEFAULT '["General","Major Donor","Regular Donor","One-Time Donor","Corporate Sponsor","Foundation","Alumni","Board Member"]'::jsonb,
  relationships jsonb DEFAULT '["Parent","Grandparent","Aunt","Uncle","Sibling","Neighbor","Friend","Alumni","Teacher","Staff","Community Member","Other"]'::jsonb,
  donation_methods jsonb DEFAULT '["Cash","Check","Credit Card","Debit Card","Bank Transfer","Zelle","Online Payment","Other"]'::jsonb,
  donation_purposes jsonb DEFAULT '["General Fund","Building Fund","Scholarship Fund","Sports Program","Arts Program","Library","Technology","Field Trip","Other"]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE donor_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_donor_settings" ON donor_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- seed default settings row
INSERT INTO donor_settings (id) VALUES (gen_random_uuid())
ON CONFLICT DO NOTHING;
