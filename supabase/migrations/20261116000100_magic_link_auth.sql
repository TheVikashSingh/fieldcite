-- Magic-link login (SPEC F-9) and email verification for free scans (F-1, CS-11).
-- Our own flow instead of Supabase Auth, so it runs and is tested on plain Postgres: one-time
-- tokens are stored only as SHA-256 hashes, and the session is a signed cookie (src/auth).
-- Everything here is server-side only (service role); clients never read these tables.

create table public.users (
  id uuid primary key default gen_random_uuid(),
  -- Always stored lowercased, so the unique constraint matches addresses case-insensitively.
  email text not null unique check (email = lower(email) and length(email) <= 254),
  email_verified_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.magic_links (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 of the token in the emailed link. The token itself is never stored.
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  email text not null check (email = lower(email)),
  purpose text not null check (purpose in ('login', 'free_scan')),
  -- Purpose-specific data, e.g. the free-scan request id or where to go after login.
  payload jsonb not null default '{}',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
-- Rate limits count recent links per address.
create index magic_links_email_created_idx on public.magic_links (email, created_at);

-- accounts.owner_id (core schema) holds public.users.id for accounts created by this flow.

alter table public.users enable row level security;
alter table public.magic_links enable row level security;
-- No policies: only the server (service role) reads or writes these tables.
revoke all on public.users, public.magic_links from anon, authenticated;
grant all on public.users, public.magic_links to service_role;
