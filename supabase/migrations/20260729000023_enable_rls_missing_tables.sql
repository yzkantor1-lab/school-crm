-- Closes a Supabase linter finding (rls_disabled_in_public): five public
-- tables had RLS disabled entirely, meaning row access was governed only by
-- Postgres table grants, not policies.
--
-- tuition_plans/tuition_payments simply never got the RLS treatment every
-- sibling financial table (donors, donations, pledges, payment_methods,
-- students, ...) already has — same trust model, same fix: any authenticated
-- staff member can read/write, no per-row scoping (this app has one shared
-- authenticated role throughout).
ALTER TABLE tuition_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuition_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_tuition_plans" ON tuition_plans
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all_tuition_payments" ON tuition_payments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- site_settings/site_pages/site_blocks back the public website
-- (app/(public)/*), which is read by anonymous visitors with no session —
-- so unlike the rest of this app, these three need real anon SELECT access
-- or the public site goes blank. Anon read is scoped to published pages
-- (and blocks belonging to a published page) to match what the app already
-- filters for in code; site_settings has no draft concept, so it's read in
-- full. All writes (the admin website editor) stay staff-only.
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_pages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_blocks   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_site_settings" ON site_settings
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "authenticated_write_site_settings" ON site_settings
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_site_settings" ON site_settings
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_site_settings" ON site_settings
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "anon_read_published_site_pages" ON site_pages
  FOR SELECT TO anon USING (published = true);
CREATE POLICY "authenticated_all_site_pages" ON site_pages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_published_site_blocks" ON site_blocks
  FOR SELECT TO anon USING (
    EXISTS (SELECT 1 FROM site_pages WHERE site_pages.id = site_blocks.page_id AND site_pages.published = true)
  );
CREATE POLICY "authenticated_all_site_blocks" ON site_blocks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
