-- Allow students to be saved without a name (fields can be filled in later)
ALTER TABLE students ALTER COLUMN first_name DROP NOT NULL;
ALTER TABLE students ALTER COLUMN last_name DROP NOT NULL;

-- Allow authenticated users to read/write students (required for client-side inserts)
CREATE POLICY "auth_students" ON students FOR ALL TO authenticated USING (true) WITH CHECK (true);
