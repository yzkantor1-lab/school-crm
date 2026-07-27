-- Stores payment-processor secrets (e.g. the Sola API key). Deliberately no
-- RLS policies are created, so with RLS enabled, only the service role
-- (used exclusively by server-side API routes) can read or write this table
-- — the anon/authenticated browser client can never retrieve the raw value,
-- unlike site_settings which the browser client can read directly.
create table payment_settings (
  id uuid primary key default uuid_generate_v4(),
  provider text not null default 'sola',
  key_name text not null,
  key_value text not null,
  updated_at timestamptz default now(),
  unique (provider, key_name)
);
alter table payment_settings enable row level security;
