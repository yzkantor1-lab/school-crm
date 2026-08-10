-- New recurring per-student fee: Phone Charge (landline system), typically
-- $15/mo, billed via a real Sola recurring schedule (same mechanism already
-- used for tuition/building fund) until staff stops it or the student
-- graduates. Plan-independent, same as registration_fee.
ALTER TABLE tuition_payments
  DROP CONSTRAINT IF EXISTS tuition_payments_payment_type_check;
ALTER TABLE tuition_payments
  ADD CONSTRAINT tuition_payments_payment_type_check
  CHECK (payment_type IN ('tuition', 'donation', 'building_fund', 'registration_fee', 'phone_charge'));
