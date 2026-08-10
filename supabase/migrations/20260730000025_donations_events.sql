-- Extends fundraising to cover: planned events, richer donation
-- categorization, donor<->student cross-linking (a donor who's also a
-- parent), and Sola Sync's ability to tell tuition charges apart from
-- donations for the same Sola customer.

-- Fundraising events (dinners, parlor meetings, campaigns) planned ahead of
-- time. `type` is free text (e.g. "Dinner", "Parlor Meeting") — descriptive
-- metadata, not a state machine, so no CHECK constraint.
create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  type text,
  notes text,
  created_at timestamptz not null default now()
);
create index idx_events_date on events(event_date);
alter table events enable row level security;
create policy "authenticated_all_events" on events for all to authenticated using (true) with check (true);

-- category: how the donation was structured (separate from the existing
-- `purpose` column, which is what the money is earmarked for, e.g. "Building
-- Fund"/"Scholarship Fund" — category and purpose are independent axes).
-- source distinguishes hand-entered donations from ones pulled in via Sola
-- Sync; sola_transaction_id is the same dedup key pattern used on
-- tuition_payments.
alter table donations
  add column if not exists category text check (category in ('monthly_recurring','one_time','event')),
  add column if not exists event_id uuid references events(id) on delete set null,
  add column if not exists source text not null default 'manual' check (source in ('manual','sola')),
  add column if not exists sola_transaction_id text unique;
create index idx_donations_event_id on donations(event_id);

-- A donor who is also a parent of an enrolled student — many-to-many since a
-- donor can be parent to more than one enrolled child, and a family may track
-- father/mother as separate donor contacts.
create table donor_students (
  donor_id uuid not null references donors(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  primary key (donor_id, student_id)
);
alter table donor_students enable row level security;
create policy "authenticated_all_donor_students" on donor_students for all to authenticated using (true) with check (true);

-- A single Sola customer can be, at once, a tuition payer (matched_student_id,
-- already existed) AND a donor (e.g. a parent who also gives to a dinner) —
-- track the donor identity independently rather than forcing one or the other.
alter table sola_sync_customers
  add column if not exists matched_donor_id uuid references donors(id) on delete set null,
  add column if not exists donor_match_status text not null default 'unmatched'
    check (donor_match_status in ('matched','needs_review','unmatched','not_a_donor')),
  add column if not exists donor_match_method text check (donor_match_method in ('sola_customer_id','name_fuzzy','parent_of_student','manual')),
  -- Set only while donor_match_method = 'parent_of_student' and no donor row
  -- exists yet — "this Sola customer looks like this student's parent."
  -- Consumed (and left as historical reference) once a donor is created and
  -- linked via donor_students; independent of matched_student_id, which is
  -- this same customer's own tuition-payer identity and may point at a
  -- different student entirely.
  add column if not exists suggested_donor_student_id uuid references students(id) on delete set null;
create index idx_sola_sync_customers_donor_status on sola_sync_customers(donor_match_status);
create index idx_sola_sync_customers_donor on sola_sync_customers(matched_donor_id);

-- Each staged Sola payment now classifies as tuition-shaped or
-- donation-shaped (or ambiguous, pending a staff decision) instead of always
-- assuming tuition — driven by schedule-description keywords at sync time,
-- always overridable in the review UI. duplicate_of_donation_id/
-- duplicate_resolution implement the "never silently merge or skip a
-- possible-duplicate donation" requirement: a fuzzy donor+amount+month match
-- lands in import_status 'needs_review' with a pointer to what it might
-- duplicate, and stays there until a human picks same/separate/correction.
alter table sola_sync_payments
  add column if not exists charge_kind text not null default 'tuition' check (charge_kind in ('tuition','donation','ambiguous')),
  add column if not exists suggested_donation_category text check (suggested_donation_category in ('monthly_recurring','one_time','event')),
  add column if not exists donation_id uuid references donations(id) on delete set null,
  add column if not exists duplicate_of_donation_id uuid references donations(id) on delete set null,
  add column if not exists duplicate_resolution text check (duplicate_resolution in ('same','separate','correction')),
  -- The category/event a staff member chose at decision time, persisted so
  -- a later same/separate/correction resolution doesn't need it resent.
  add column if not exists resolved_category text check (resolved_category in ('monthly_recurring','one_time','event')),
  add column if not exists resolved_event_id uuid references events(id) on delete set null;

alter table sola_sync_payments drop constraint if exists sola_sync_payments_import_status_check;
alter table sola_sync_payments add constraint sola_sync_payments_import_status_check
  check (import_status in ('pending','duplicate','imported','skipped','needs_review'));
