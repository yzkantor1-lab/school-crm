-- Sola Sync: stages Sola's existing customer/schedule/transaction history so
-- it can be matched against CRM students, reviewed side by side, and only
-- written into tuition_payments once a staff member explicitly approves it.
-- Nothing here writes financial data automatically — these are staging
-- tables for the /admin/sola-sync review UI.

create table sola_sync_customers (
  id uuid primary key default gen_random_uuid(),
  sola_customer_id text unique not null,
  sola_customer_number text,
  bill_first_name text,
  bill_last_name text,
  email text,
  -- 'matched': confirmed link to a CRM student (exact id/number match, or a
  -- needs_review suggestion the user explicitly confirmed).
  -- 'needs_review': a name-based suggestion exists but was never auto-trusted
  -- for financial data — or the user manually linked it and hasn't confirmed yet.
  -- 'unmatched': no plausible CRM student found at all.
  -- 'not_a_student': user confirmed this Sola customer isn't a student (e.g. a donor).
  -- 'merged': matched, and every staged payment has been resolved (imported/skipped/duplicate).
  match_status text not null default 'unmatched'
    check (match_status in ('matched','needs_review','unmatched','not_a_student','merged')),
  matched_student_id uuid references students(id) on delete set null,
  match_method text check (match_method in ('sola_customer_id','customer_number','name_fuzzy','manual')),
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index idx_sola_sync_customers_status on sola_sync_customers(match_status);
create index idx_sola_sync_customers_student on sola_sync_customers(matched_student_id);

-- Sola recurring schedules — the only place a dollar Amount is actually
-- exposed (ListTransactions/GetTransaction don't return one), so each
-- payment's amount below is inferred from its parent schedule.
create table sola_sync_schedules (
  id uuid primary key default gen_random_uuid(),
  sola_sync_customer_id uuid not null references sola_sync_customers(id) on delete cascade,
  sola_schedule_id text unique not null,
  description text,
  amount numeric(10,2),
  interval_type text,
  interval_count integer,
  total_payments integer,
  payments_processed integer,
  next_scheduled_date date,
  created_at timestamptz not null default now()
);
create index idx_sola_sync_schedules_customer on sola_sync_schedules(sola_sync_customer_id);

create table sola_sync_payments (
  id uuid primary key default gen_random_uuid(),
  sola_sync_customer_id uuid not null references sola_sync_customers(id) on delete cascade,
  sola_sync_schedule_id uuid references sola_sync_schedules(id) on delete set null,
  sola_transaction_id text unique not null,
  amount numeric(10,2),
  transaction_date date,
  gateway_status text,
  -- Sola has no fee-type field at all; this is an amount-based guess
  -- ($250 -> registration_fee, $750 -> building_fund, else tuition) shown
  -- as an editable suggestion in the review UI, never auto-imported as-is.
  suggested_fee_type text check (suggested_fee_type in ('tuition','building_fund','registration_fee')),
  import_status text not null default 'pending'
    check (import_status in ('pending','duplicate','imported','skipped')),
  tuition_payment_id uuid references tuition_payments(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_sola_sync_payments_customer on sola_sync_payments(sola_sync_customer_id);
create index idx_sola_sync_payments_status on sola_sync_payments(import_status);

alter table sola_sync_customers enable row level security;
alter table sola_sync_schedules enable row level security;
alter table sola_sync_payments  enable row level security;

create policy "authenticated_all_sola_sync_customers" on sola_sync_customers
  for all to authenticated using (true) with check (true);
create policy "authenticated_all_sola_sync_schedules" on sola_sync_schedules
  for all to authenticated using (true) with check (true);
create policy "authenticated_all_sola_sync_payments" on sola_sync_payments
  for all to authenticated using (true) with check (true);

-- Dedup key: once a staged payment is imported, its Sola transaction id is
-- stamped here so re-running a sync (or approving twice) can never create a
-- duplicate tuition_payments row for the same Sola transaction.
alter table tuition_payments add column if not exists sola_transaction_id text unique;
