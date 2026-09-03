-- Lets staff fill in a different amount for each period of a recurring
-- charge, instead of one flat amount every time — Sola's schedule API only
-- supports a single flat amount per schedule, so a "custom calendar" is
-- really a batch of one-time (TotalPayments=1) schedules under the hood in
-- auto_charge mode, one per entry, each firing on its own date for its own
-- amount. In planning_only mode no Sola schedules exist at all — the
-- entries are just a reference grid staff fills in expected amounts against
-- and charges/records manually via the existing Add Payment / Charge Now
-- flow when each one comes due.
--
-- One calendar belongs to either a student or a donor, never both (building
-- fund/phone charge/tuition for a student; donation for a donor) — same
-- ownership shape as payment_schedules itself.
create table custom_payment_calendars (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  donor_id uuid references donors(id) on delete cascade,
  purpose text not null check (purpose in ('tuition', 'building_fund', 'phone_charge', 'donation')),
  mode text not null check (mode in ('auto_charge', 'planning_only')),
  payment_method_id uuid references payment_methods(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  check ((student_id is not null) <> (donor_id is not null))
);
create index idx_custom_payment_calendars_student on custom_payment_calendars(student_id) where student_id is not null;
create index idx_custom_payment_calendars_donor on custom_payment_calendars(donor_id) where donor_id is not null;

-- payment_schedule_id links an auto_charge entry to the one-shot
-- payment_schedules row created for it (null until that schedule is
-- created, and always null in planning_only mode). 'charged'/'failed'
-- aren't set automatically by the webhook — computed live from the linked
-- schedule's Sola status instead (see /api/sola/schedule GET), the same
-- "don't duplicate what Sola already tracks" choice made for
-- payment_schedules.total_payments elsewhere in this app — so this column
-- only ever needs to distinguish planned vs. scheduled.
create table custom_payment_calendar_entries (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references custom_payment_calendars(id) on delete cascade,
  period_date date not null,
  amount numeric not null check (amount > 0),
  payment_schedule_id uuid references payment_schedules(id) on delete set null,
  status text not null default 'planned' check (status in ('planned', 'scheduled', 'cancelled')),
  notes text,
  created_at timestamptz not null default now()
);
create index idx_custom_payment_calendar_entries_calendar on custom_payment_calendar_entries(calendar_id);

alter table custom_payment_calendars enable row level security;
alter table custom_payment_calendar_entries enable row level security;
create policy "authenticated_all_custom_payment_calendars" on custom_payment_calendars
  for all to authenticated using (true) with check (true);
create policy "authenticated_all_custom_payment_calendar_entries" on custom_payment_calendar_entries
  for all to authenticated using (true) with check (true);
