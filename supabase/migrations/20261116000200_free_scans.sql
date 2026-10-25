-- Free-scan requests (SPEC F-1) and their abuse controls (CS-11).
-- A request is created by the landing-page form, verified through an emailed link, then runs
-- as a 15-call free scan through the credit ledger (CS-4) and the breakers (CS-7).

create table public.free_scan_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  -- The company's domain, e.g. "gorilladesk.com". CS-11: 1 free scan per domain per 30 days.
  domain text not null check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  brand_name text not null check (length(brand_name) between 1 and 80),
  category_slug text not null check (category_slug ~ '^[a-z0-9-]+$'),
  country text not null check (country in ('US', 'UK', 'CA', 'AU')),
  competitors text[] not null default '{}' check (cardinality(competitors) <= 3),
  -- HMAC of the client IP (never the IP itself). CS-11: at most 3 free scans per IP per day.
  ip_hash bytea not null check (octet_length(ip_hash) = 32),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'rejected')),
  scan_id uuid references public.scans (id) on delete set null,
  -- SHA-256 of the token in the status and report links (/scan/<token>, /r/<token>).
  report_token_hash bytea unique check (octet_length(report_token_hash) = 32),
  error text,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  finished_at timestamptz
);
create index free_scan_requests_email_idx on public.free_scan_requests (email, verified_at);
create index free_scan_requests_domain_idx on public.free_scan_requests (domain, verified_at);
create index free_scan_requests_ip_idx on public.free_scan_requests (ip_hash, created_at);

alter table public.free_scan_requests enable row level security;
-- No policies: only the server (service role) reads or writes requests.
revoke all on public.free_scan_requests from anon, authenticated;
grant all on public.free_scan_requests to service_role;
