-- site_settings' anon-read policy was written for the public website's use
-- of this table (school_name, logo_url, etc.) but was never scoped to those
-- keys — USING (true) applies table-wide, so an anonymous request (the anon
-- key ships in the browser bundle) could read google_client_secret and
-- google_refresh_token straight out of the database. Restrict anon read to
-- the actual public keys; staff (authenticated) keep full read access.
drop policy if exists "anon_read_site_settings" on site_settings;

create policy "anon_read_public_site_settings" on site_settings
  for select to anon
  using (key in ('school_name','school_email','school_phone','school_address','website','school_tagline','logo_url'));

create policy "authenticated_read_site_settings" on site_settings
  for select to authenticated
  using (true);
