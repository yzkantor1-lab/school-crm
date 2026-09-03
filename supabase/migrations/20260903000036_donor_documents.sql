-- Donor-side equivalent of tuition_documents (20260805000027) — a flat
-- per-donor file list, no plan-linking join table since donors don't have
-- the "plan" concept students do. Used both for manual uploads and for
-- auto-archiving sent/printed donation receipts (see lib/documentArchive.ts)
-- so staff can tell at a glance whether a receipt already went out to a
-- given donor, and pull up exactly what was sent (including whatever note
-- was added) without digging through Communications history.
create table donor_documents (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references donors(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_size bigint,
  content_type text,
  notes text,
  uploaded_at timestamptz not null default now()
);
create index idx_donor_documents_donor on donor_documents(donor_id);

alter table donor_documents enable row level security;
create policy "authenticated_all_donor_documents" on donor_documents
  for all to authenticated using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('donor-documents', 'donor-documents', false)
on conflict (id) do nothing;

create policy "authenticated_all_donor_documents_storage"
on storage.objects for all to authenticated
using (bucket_id = 'donor-documents')
with check (bucket_id = 'donor-documents');
