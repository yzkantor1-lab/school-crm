-- Audit + undo/redo log for the in-CRM AI assistant's write tools (see
-- lib/assistant/tools.ts). Every insert/update/delete the assistant makes
-- on tuition_payments or donations is recorded here with a full snapshot
-- of the row before and after, so a later "undo that" can restore exactly
-- what was there — including bringing back a deleted row with its original
-- id — and a "redo" can re-apply the change after an undo. Deliberately not
-- used for send_email (nothing to snapshot or reverse) or for tables the
-- assistant only reads.
create table assistant_actions (
  id uuid primary key default gen_random_uuid(),
  performed_by uuid references auth.users(id) on delete set null,
  action_type text not null check (action_type in ('insert', 'update', 'delete')),
  table_name text not null,
  record_id uuid not null,
  before_data jsonb,
  after_data jsonb,
  description text not null,
  undone_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_assistant_actions_created on assistant_actions(created_at desc);

alter table assistant_actions enable row level security;
create policy "authenticated_all_assistant_actions" on assistant_actions
  for all to authenticated using (true) with check (true);
