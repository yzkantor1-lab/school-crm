-- Uploaded tuition contract documents (signed enrollment agreements, etc.) —
-- distinct from the generated statements/receipts logged in `communications`.
-- These are actual files staff upload, stored in Supabase Storage; this
-- table just tracks metadata and, via the join table below, which specific
-- plan(s)/years a document applies to.
--
-- A document is student-level by default (no plan link at all — e.g. a
-- general enrollment contract) and can additionally be linked to one or more
-- specific tuition_plans rows. This is what lets a document uploaded for one
-- year be reused ("linked") for a future semester/year's plan without
-- re-uploading it, per the per-plan Documents section's "Link Existing"
-- action, while a brand-new document can still be uploaded and immediately
-- scoped to just that plan.
create table tuition_documents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_size bigint,
  content_type text,
  -- Freeform organizational tag (e.g. "2026–2027") — independent of any
  -- plan link, since a document is often uploaded before that year's plan
  -- exists yet in the system.
  academic_year text,
  notes text,
  uploaded_at timestamptz not null default now()
);
create index idx_tuition_documents_student on tuition_documents(student_id);

create table tuition_document_plans (
  document_id uuid not null references tuition_documents(id) on delete cascade,
  tuition_plan_id uuid not null references tuition_plans(id) on delete cascade,
  primary key (document_id, tuition_plan_id)
);
create index idx_tuition_document_plans_plan on tuition_document_plans(tuition_plan_id);

alter table tuition_documents enable row level security;
alter table tuition_document_plans enable row level security;
create policy "authenticated_all_tuition_documents" on tuition_documents
  for all to authenticated using (true) with check (true);
create policy "authenticated_all_tuition_document_plans" on tuition_document_plans
  for all to authenticated using (true) with check (true);

-- Private bucket — these are signed contracts with family financial/personal
-- info, not public files. Same trust model as every other table in this
-- app: any authenticated staff member can read/write, no per-row scoping.
insert into storage.buckets (id, name, public)
values ('tuition-documents', 'tuition-documents', false)
on conflict (id) do nothing;

create policy "authenticated_all_tuition_documents_storage"
on storage.objects for all to authenticated
using (bucket_id = 'tuition-documents')
with check (bucket_id = 'tuition-documents');
