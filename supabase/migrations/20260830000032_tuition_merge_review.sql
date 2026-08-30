-- Tuition side of Sola sync gets the same "never silently guess on a
-- near-duplicate" review flow donations already have (see
-- 20260730000025_donations_events.sql's duplicate_of_donation_id). Previously
-- tuition only auto-merged within the same calendar month and otherwise
-- imported as a brand-new payment with zero confirmation — a payment landing
-- a few days into an adjacent month just silently duplicated. This adds a
-- second candidate pointer for tuition, and persists the fee-type/plan choice
-- made at decision time so a later same/separate/correction resolution
-- doesn't need it resent (mirrors resolved_category/resolved_event_id).
alter table sola_sync_payments
  add column if not exists duplicate_of_tuition_payment_id uuid references tuition_payments(id) on delete set null,
  add column if not exists resolved_fee_type text check (resolved_fee_type in ('tuition','building_fund','registration_fee')),
  add column if not exists resolved_tuition_plan_id uuid references tuition_plans(id) on delete set null;

-- How many days apart a same-amount/same-type tuition payment can be from a
-- Sola transaction and still be flagged for review instead of imported as a
-- separate payment outright. Editable in Settings > Payments; defaults to 30
-- if never set (see app/api/sola-settings/route.ts).
insert into payment_settings (provider, key_name, key_value)
values ('sola', 'tuition_merge_window_days', '30')
on conflict (provider, key_name) do nothing;
