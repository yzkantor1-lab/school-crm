-- Multi-account outbound email: replaces the single google_refresh_token/
-- google_from_email pair in site_settings with one row per connected
-- account, each using whichever auth method fits it — OAuth (for a
-- Workspace address, via the shared google_client_id/secret still in
-- site_settings) or a Gmail App Password (for a personal Gmail account that
-- can't be added to an Internal-audience OAuth app). Exactly one row can be
-- the default "from" address; sendMailViaGoogle can still be pointed at a
-- specific account per send.
create table email_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  email text not null unique,
  method text not null check (method in ('oauth','app_password')),
  is_default boolean not null default false,
  -- Set iff method='oauth'.
  oauth_refresh_token text,
  -- Set iff method='app_password' — a Gmail App Password, not the account's
  -- real password (requires 2-Step Verification enabled on that account).
  app_password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one default at a time — a second row can't be inserted/updated to
-- is_default=true without first unsetting the current default (enforced by
-- the app, this index just guarantees it at the data layer too).
create unique index one_default_email_account on email_accounts (is_default) where is_default;

alter table email_accounts enable row level security;

-- Credentials live here (a refresh token, an app password) — staff-only,
-- full stop. No anon policy at all, unlike site_settings' mistake.
create policy "authenticated_all_email_accounts" on email_accounts
  for all to authenticated using (true) with check (true);

-- Which connected account actually sent a given logged communication — not
-- backfilled for historical rows (we don't know which account those went
-- through), only recorded going forward.
alter table communications add column if not exists sent_from_email text;

-- The old single-account fields are superseded by email_accounts above;
-- nothing reads them anymore. google_client_id/google_client_secret stay —
-- they're the shared OAuth app registration, reused for any OAuth account.
delete from site_settings where key in ('google_refresh_token', 'google_from_email');
