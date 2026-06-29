-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────
-- ACADEMIC TERMS
-- ─────────────────────────────────────────────
create table academic_terms (
  id uuid primary key default uuid_generate_v4(),
  name text not null,              -- e.g. "Fall 2026", "Spring 2027"
  start_date date not null,
  end_date date not null,
  is_active boolean default false,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- STAFF
-- ─────────────────────────────────────────────
create table staff (
  id uuid primary key default uuid_generate_v4(),
  first_name text not null,
  last_name text not null,
  email text unique not null,
  phone text,
  role text not null,             -- 'teacher', 'admin', 'principal', 'support'
  hire_date date,
  is_active boolean default true,
  notes text,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- STUDENTS
-- ─────────────────────────────────────────────
create table students (
  id uuid primary key default uuid_generate_v4(),
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  gender text,
  grade_level text,
  student_id text unique,         -- school-assigned ID number
  enrollment_date date,
  status text default 'active',   -- 'active', 'inactive', 'graduated', 'withdrawn'
  allergies text,
  medical_notes text,
  notes text,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- PARENTS / GUARDIANS
-- ─────────────────────────────────────────────
create table guardians (
  id uuid primary key default uuid_generate_v4(),
  first_name text not null,
  last_name text not null,
  email text unique,
  phone_primary text,
  phone_secondary text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,
  relationship text,              -- 'father', 'mother', 'guardian'
  is_primary_contact boolean default false,
  notes text,
  created_at timestamptz default now()
);

-- Link students to guardians (many-to-many)
create table student_guardians (
  student_id uuid references students(id) on delete cascade,
  guardian_id uuid references guardians(id) on delete cascade,
  primary key (student_id, guardian_id)
);

-- ─────────────────────────────────────────────
-- CLASSES / COURSES
-- ─────────────────────────────────────────────
create table classes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  subject text,
  grade_level text,
  term_id uuid references academic_terms(id),
  room text,
  schedule text,                  -- e.g. "Mon/Wed 9-10am"
  max_students int,
  created_at timestamptz default now()
);

-- Students enrolled in classes
create table class_enrollments (
  id uuid primary key default uuid_generate_v4(),
  class_id uuid references classes(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  enrolled_at timestamptz default now(),
  status text default 'active',   -- 'active', 'dropped'
  unique (class_id, student_id)
);

-- Staff assigned to classes
create table class_staff (
  class_id uuid references classes(id) on delete cascade,
  staff_id uuid references staff(id) on delete cascade,
  role text default 'teacher',
  primary key (class_id, staff_id)
);

-- ─────────────────────────────────────────────
-- LUNCH PROGRAM
-- ─────────────────────────────────────────────
create table lunch_menus (
  id uuid primary key default uuid_generate_v4(),
  term_id uuid references academic_terms(id),
  date date not null,
  description text not null,
  price_student numeric(8,2) not null default 0,
  price_staff numeric(8,2) not null default 0,
  created_at timestamptz default now()
);

create table lunch_accounts (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid references students(id) on delete cascade unique,
  balance numeric(10,2) not null default 0,
  updated_at timestamptz default now()
);

create table lunch_transactions (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references lunch_accounts(id),
  amount numeric(10,2) not null,  -- positive = deposit, negative = purchase
  type text not null,             -- 'deposit', 'purchase', 'adjustment'
  description text,
  menu_id uuid references lunch_menus(id),
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- LIBRARY / BOOKS
-- ─────────────────────────────────────────────
create table books (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  author text,
  isbn text,
  category text,                  -- 'textbook', 'library', 'reference'
  total_copies int default 1,
  available_copies int default 1,
  notes text,
  created_at timestamptz default now()
);

create table book_loans (
  id uuid primary key default uuid_generate_v4(),
  book_id uuid references books(id),
  student_id uuid references students(id),
  loaned_at timestamptz default now(),
  due_date date,
  returned_at timestamptz,
  condition_out text,             -- 'good', 'fair', 'poor'
  condition_in text,
  notes text
);

-- ─────────────────────────────────────────────
-- BILLING & PAYMENTS
-- ─────────────────────────────────────────────
create table fee_categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,             -- 'Tuition', 'Registration', 'Supplies', 'Activities'
  description text,
  is_recurring boolean default false,
  default_amount numeric(10,2)
);

create table invoices (
  id uuid primary key default uuid_generate_v4(),
  invoice_number text unique not null,
  guardian_id uuid references guardians(id),
  student_id uuid references students(id),
  term_id uuid references academic_terms(id),
  issue_date date not null default current_date,
  due_date date,
  status text default 'unpaid',   -- 'unpaid', 'partial', 'paid', 'void'
  subtotal numeric(10,2) not null default 0,
  discount numeric(10,2) default 0,
  total numeric(10,2) not null default 0,
  notes text,
  created_at timestamptz default now()
);

create table invoice_items (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid references invoices(id) on delete cascade,
  fee_category_id uuid references fee_categories(id),
  description text not null,
  quantity int default 1,
  unit_price numeric(10,2) not null,
  total numeric(10,2) not null
);

create table payments (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid references invoices(id),
  guardian_id uuid references guardians(id),
  amount numeric(10,2) not null,
  method text not null,           -- 'cash', 'check', 'credit_card', 'ach', 'other'
  stripe_payment_intent_id text,  -- for card payments
  reference_number text,          -- check number, etc.
  paid_at timestamptz default now(),
  notes text,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- ACCOUNTING LEDGER
-- ─────────────────────────────────────────────
create table ledger_accounts (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,      -- e.g. '1000', '4000'
  name text not null,             -- e.g. 'Cash', 'Tuition Revenue'
  type text not null,             -- 'asset', 'liability', 'equity', 'revenue', 'expense'
  description text,
  is_active boolean default true
);

create table ledger_entries (
  id uuid primary key default uuid_generate_v4(),
  entry_date date not null default current_date,
  description text not null,
  reference_id uuid,              -- links to payment, invoice, etc.
  reference_type text,            -- 'payment', 'invoice', 'adjustment'
  created_by uuid references staff(id),
  created_at timestamptz default now()
);

create table ledger_lines (
  id uuid primary key default uuid_generate_v4(),
  entry_id uuid references ledger_entries(id) on delete cascade,
  account_id uuid references ledger_accounts(id),
  debit numeric(12,2) default 0,
  credit numeric(12,2) default 0,
  notes text
);

-- ─────────────────────────────────────────────
-- COMMUNICATIONS / NOTES
-- ─────────────────────────────────────────────
create table communications (
  id uuid primary key default uuid_generate_v4(),
  type text not null,             -- 'note', 'email', 'call', 'meeting'
  subject text,
  body text,
  student_id uuid references students(id),
  guardian_id uuid references guardians(id),
  staff_id uuid references staff(id),
  created_by uuid references staff(id),
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- ROW-LEVEL SECURITY (enable on all tables)
-- ─────────────────────────────────────────────
alter table academic_terms enable row level security;
alter table staff enable row level security;
alter table students enable row level security;
alter table guardians enable row level security;
alter table student_guardians enable row level security;
alter table classes enable row level security;
alter table class_enrollments enable row level security;
alter table class_staff enable row level security;
alter table lunch_menus enable row level security;
alter table lunch_accounts enable row level security;
alter table lunch_transactions enable row level security;
alter table books enable row level security;
alter table book_loans enable row level security;
alter table fee_categories enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;
alter table payments enable row level security;
alter table ledger_accounts enable row level security;
alter table ledger_entries enable row level security;
alter table ledger_lines enable row level security;
alter table communications enable row level security;

-- ─────────────────────────────────────────────
-- DEFAULT CHART OF ACCOUNTS
-- ─────────────────────────────────────────────
insert into ledger_accounts (code, name, type) values
  ('1000', 'Cash', 'asset'),
  ('1100', 'Accounts Receivable', 'asset'),
  ('1200', 'Prepaid Expenses', 'asset'),
  ('2000', 'Accounts Payable', 'liability'),
  ('3000', 'Retained Earnings', 'equity'),
  ('4000', 'Tuition Revenue', 'revenue'),
  ('4100', 'Registration Fees', 'revenue'),
  ('4200', 'Activity Fees', 'revenue'),
  ('4300', 'Lunch Revenue', 'revenue'),
  ('5000', 'Salaries & Wages', 'expense'),
  ('5100', 'Supplies & Materials', 'expense'),
  ('5200', 'Facilities', 'expense'),
  ('5300', 'Technology', 'expense');

-- ─────────────────────────────────────────────
-- DEFAULT FEE CATEGORIES
-- ─────────────────────────────────────────────
insert into fee_categories (name, is_recurring) values
  ('Tuition', true),
  ('Registration Fee', false),
  ('Supply Fee', false),
  ('Activity Fee', false),
  ('Late Fee', false),
  ('Lunch', false);
