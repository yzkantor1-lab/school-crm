-- Lets staff set a default categorization on a Sola customer/schedule that
-- was set up directly in Sola (not through the CRM), once, at match time —
-- so every future Sola Sync pull classifies its new payments automatically
-- instead of landing in 'ambiguous'/"needs kind". Applies only to payments
-- staged after the default is set; anything already staged/imported is
-- untouched (see run/route.ts, which only classifies newly-inserted rows).
--
-- Schedule-level default takes priority (a customer can have one schedule
-- that's tuition and another that's a donation); customer-level is the
-- fallback for scheduleless one-off charges.

alter table sola_sync_schedules
  add column if not exists default_purpose text
    check (default_purpose in ('tuition','building_fund','registration_fee','donation')),
  add column if not exists default_donation_category text
    check (default_donation_category in ('monthly_recurring','one_time','event')),
  -- Set once "Track as Recurring" promotes this Sola-native schedule into
  -- payment_schedules (so it shows on the student's tuition page like a
  -- CRM-created plan) and tags the live Sola schedule's Custom02 for future
  -- webhook attribution. Prevents re-promoting/re-tagging the same schedule.
  add column if not exists linked_payment_schedule_id uuid references payment_schedules(id) on delete set null;

alter table sola_sync_customers
  add column if not exists default_purpose text
    check (default_purpose in ('tuition','building_fund','registration_fee','donation')),
  add column if not exists default_donation_category text
    check (default_donation_category in ('monthly_recurring','one_time','event'));
