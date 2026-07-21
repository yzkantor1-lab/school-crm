-- Extend communications so it can log generated letters/receipts sent
-- through the app (tuition statements, payment receipts, donation receipts),
-- not just manually-entered notes/calls/meetings.
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS donor_id uuid REFERENCES donors(id),
  ADD COLUMN IF NOT EXISTS recipients text,
  ADD COLUMN IF NOT EXISTS attachment_filename text;
