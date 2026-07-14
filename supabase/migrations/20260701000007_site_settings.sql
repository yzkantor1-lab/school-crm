-- Add list-type settings as JSON arrays in the existing key-value site_settings table
INSERT INTO site_settings (key, value)
VALUES
  ('grade_levels',   '["Pre-K","Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade","6th Grade","7th Grade","8th Grade"]'),
  ('semesters',      '["Elul 2024","Winter 2025","Spring 2025","Summer 2025","Elul 2025","Winter 2026"]'),
  ('academic_years', '["2024-2025","2025-2026","2026-2027"]')
ON CONFLICT (key) DO NOTHING;
