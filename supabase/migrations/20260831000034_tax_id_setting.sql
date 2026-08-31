-- The school's Tax ID/EIN previously only existed as free text inside a
-- website paragraph block ("Tax ID: 88-3887568") — fine for the public site,
-- but not something the donation receipt PDF can reliably read. Storing it
-- as its own site_settings key instead of parsing it out of page content.
insert into site_settings (key, value) values ('tax_id', '88-3887568')
on conflict (key) do nothing;
