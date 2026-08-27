-- Generalizes the manual "upload template, merge per recipient, generate,
-- optionally email" workflow (first proven by hand for the 2026-2027
-- tuition contracts) into a reusable feature: any .docx template with
-- {{Merge_Field}} placeholders, addressed to students or donors.

create table document_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  file_path text not null,
  -- {{Field}} names auto-detected from the template at upload time, so the
  -- merge-job UI knows what it needs to collect without manual declaration.
  merge_fields text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- One row per generated document — the merge job's actual output, addressed
-- to exactly one student or donor. Kept separate from tuition_documents
-- (which stays student-only and untouched) since this needs to also cover
-- donors, and any future document type, not just tuition contracts.
create table merge_documents (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references document_templates(id) on delete set null,
  student_id uuid references students(id) on delete cascade,
  donor_id uuid references donors(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  -- Populated only if PDF conversion was requested for this job and
  -- succeeded — the docx above is always present regardless, so a PDF
  -- conversion failure never blocks having the merged document at all.
  pdf_file_path text,
  created_at timestamptz not null default now(),
  check ((student_id is not null) <> (donor_id is not null))
);
create index idx_merge_documents_student on merge_documents(student_id);
create index idx_merge_documents_donor on merge_documents(donor_id);

alter table document_templates enable row level security;
alter table merge_documents enable row level security;
create policy "authenticated_all_document_templates" on document_templates
  for all to authenticated using (true) with check (true);
create policy "authenticated_all_merge_documents" on merge_documents
  for all to authenticated using (true) with check (true);

-- Private buckets — same trust model as tuition-documents: staff-only, no
-- anon policy at all.
insert into storage.buckets (id, name, public)
values ('mail-merge-templates', 'mail-merge-templates', false)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
values ('merge-documents', 'merge-documents', false)
on conflict (id) do nothing;

create policy "authenticated_all_mail_merge_templates_storage"
on storage.objects for all to authenticated
using (bucket_id = 'mail-merge-templates')
with check (bucket_id = 'mail-merge-templates');

create policy "authenticated_all_merge_documents_storage"
on storage.objects for all to authenticated
using (bucket_id = 'merge-documents')
with check (bucket_id = 'merge-documents');
