-- Printing a statement/receipt now gets logged the same way emailing one
-- already was (type='email' — no CHECK constraint on communications.type,
-- so 'print' needs no schema change there), so the Sent Letters history
-- covers both delivery methods, not just email.
--
-- pdf_base64 persists the actual document as it was generated at that
-- moment — not just a description of it — so it can be reopened exactly as
-- sent/printed later, even after the underlying balances have since changed.
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS pdf_base64 text;
