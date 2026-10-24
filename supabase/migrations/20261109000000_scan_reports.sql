-- Report snapshots behind private share links (SPEC F-2).
-- The share token is only ever in the link: the table keeps its SHA-256, so a database read
-- can't be turned into working links. Reports are read server-side with the service role only.

create table public.scan_reports (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null unique references public.scans (id) on delete cascade,
  share_token_hash bytea not null unique check (octet_length(share_token_hash) = 32),
  -- The ScanReport JSON (src/scan/report.ts), without raw provider payloads.
  report jsonb not null,
  created_at timestamptz not null default now(),
  -- A revoked link returns the same 404 as an unknown one.
  revoked_at timestamptz
);

alter table public.scan_reports enable row level security;
-- No policies: clients never read reports directly, only through the server's share-link lookup.
-- Supabase's default privileges grant new tables to anon and authenticated, so revoke them.
revoke all on public.scan_reports from anon, authenticated;
grant all on public.scan_reports to service_role;
