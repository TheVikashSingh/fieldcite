-- Core data model (SPEC §6.2). All writes come from the server with the service role;
-- signed-in users can only read their own account's rows (row-level security on every table).

-- Accounts and billing ------------------------------------------------------------------

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  -- auth.users.id of the single user of this account (F-9). No foreign key, so the
  -- schema also runs on plain Postgres.
  owner_id uuid not null unique,
  email text not null,
  domain text,
  -- Cached balance, changed only by the ledger functions (CS-4). Mirrors the latest
  -- credit_ledger.balance_after for this account. 1 credit = 1 engine call.
  credit_balance integer not null default 0 check (credit_balance >= 0),
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  plan text not null check (plan in ('starter', 'growth')),
  status text not null check (status in ('active', 'past_due', 'cancelled')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  -- The merchant of record's subscription id.
  provider_subscription_id text unique,
  created_at timestamptz not null default now(),
  check (current_period_end > current_period_start)
);
create index subscriptions_account_id_idx on public.subscriptions (account_id);

-- Categories, brands and questions ------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  trade text not null,
  country text check (country in ('US', 'UK', 'CA', 'AU')),
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text,
  aliases text[] not null default '{}',
  category_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create unique index brands_domain_key on public.brands (lower(domain)) where domain is not null;

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  text text not null,
  intent text,
  source text not null check (source in ('template', 'generated', 'user')),
  created_at timestamptz not null default now()
);
create index questions_category_id_idx on public.questions (category_id);

-- Scans and engine calls ----------------------------------------------------------------

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  -- Null only for internal baseline scans (M-1).
  account_id uuid references public.accounts (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  country text check (country in ('US', 'UK', 'CA', 'AU')),
  type text not null check (type in ('free', 'paid', 'baseline')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'cancelled')),
  -- CS-5: at most 150 calls per scan.
  calls_reserved integer not null check (calls_reserved between 1 and 150),
  calls_used integer not null default 0 check (calls_used >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  -- CS-4: a scan can never use more calls than it reserved.
  check (calls_used <= calls_reserved),
  check ((type = 'baseline') = (account_id is null))
);
create index scans_account_id_idx on public.scans (account_id);
-- CS-5: at most 1 running scan per account. The ledger function checks this first;
-- the index is the backstop.
create unique index scans_one_running_per_account on public.scans (account_id) where status = 'running';

create table public.engine_calls (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans (id) on delete cascade,
  engine text not null check (engine in ('openai', 'perplexity', 'gemini')),
  model text not null,
  question_id uuid references public.questions (id) on delete set null,
  -- Kept as text too: command-line scans use question sets that are not in the database.
  question_text text not null,
  run integer not null default 1 check (run >= 1),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  search_calls integer not null default 0 check (search_calls >= 0),
  -- CS-9: tokens × the pricing table in code, plus search fees.
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  attempts integer not null default 0 check (attempts between 0 and 3),
  status text not null check (status in ('ok', 'error')),
  error text,
  cache_hit boolean not null default false,
  created_at timestamptz not null default now()
);
create index engine_calls_scan_id_idx on public.engine_calls (scan_id);
create index engine_calls_created_at_idx on public.engine_calls (created_at);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  engine_call_id uuid not null unique references public.engine_calls (id) on delete cascade,
  text text not null,
  -- Raw provider response (M-1). Raw text is kept 180 days; structured rows forever.
  raw jsonb,
  created_at timestamptz not null default now()
);

create table public.brand_mentions (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.answers (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  position integer not null check (position >= 1),
  sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  created_at timestamptz not null default now()
);
create index brand_mentions_answer_id_idx on public.brand_mentions (answer_id);
create index brand_mentions_brand_id_idx on public.brand_mentions (brand_id);

-- Action database (M-2). Never exposed to clients and never committed to the repo.
create table public.cited_pages (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  domain text not null,
  page_type text,
  publisher text,
  contact_url text,
  submission_url text,
  affiliate_program boolean,
  sponsorship_price text,
  brands_mentioned text[] not null default '{}',
  last_fetched_at timestamptz,
  curator_notes text,
  outreach_outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cited_pages_domain_idx on public.cited_pages (domain);

create table public.citations (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.answers (id) on delete cascade,
  url text not null,
  title text,
  position integer not null check (position >= 1),
  cited_page_id uuid references public.cited_pages (id) on delete set null,
  created_at timestamptz not null default now()
);
create index citations_answer_id_idx on public.citations (answer_id);
create index citations_cited_page_id_idx on public.citations (cited_page_id);

-- Credits and spend ---------------------------------------------------------------------

-- Append-only (CS-4). Written only by the functions in the credit ledger migration.
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('grant', 'reserve', 'refund', 'adjust')),
  scan_id uuid references public.scans (id) on delete set null,
  balance_after integer not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);
create index credit_ledger_account_id_idx on public.credit_ledger (account_id, id);

create table public.spend_daily (
  day date not null,
  engine text not null check (engine in ('openai', 'perplexity', 'gemini')),
  -- 'free', 'paid', 'baseline', or 'account:<uuid>'.
  scope text not null,
  usd numeric(12, 6) not null default 0 check (usd >= 0),
  primary key (day, engine, scope)
);

create table public.answer_cache (
  id uuid primary key default gen_random_uuid(),
  engine text not null check (engine in ('openai', 'perplexity', 'gemini')),
  model text not null,
  -- The hash covers the normalized question and the pinned country (SPEC §8).
  normalized_question_hash text not null,
  answer_id uuid not null references public.answers (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (engine, model, normalized_question_hash)
);
create index answer_cache_expires_at_idx on public.answer_cache (expires_at);

-- Row-level security --------------------------------------------------------------------

alter table public.accounts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.questions enable row level security;
alter table public.scans enable row level security;
alter table public.engine_calls enable row level security;
alter table public.answers enable row level security;
alter table public.brand_mentions enable row level security;
alter table public.cited_pages enable row level security;
alter table public.citations enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.spend_daily enable row level security;
alter table public.answer_cache enable row level security;

-- Clients read through RLS and never write. TRUNCATE ignores RLS, so it is revoked too.
grant select on all tables in schema public to anon, authenticated;
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on public.cited_pages, public.spend_daily, public.answer_cache from anon, authenticated;
grant all on all tables in schema public to service_role;

create policy accounts_select_own on public.accounts
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy subscriptions_select_own on public.subscriptions
  for select to authenticated
  using (exists (select 1 from public.accounts a where a.id = account_id and a.owner_id = (select auth.uid())));

create policy categories_select_public on public.categories
  for select to anon, authenticated
  using (is_public);

create policy brands_select on public.brands
  for select to authenticated
  using (true);

create policy questions_select_public on public.questions
  for select to anon, authenticated
  using (exists (select 1 from public.categories c where c.id = category_id and c.is_public));

create policy scans_select_own on public.scans
  for select to authenticated
  using (exists (select 1 from public.accounts a where a.id = account_id and a.owner_id = (select auth.uid())));

-- These rely on the scans policy: a user sees a scan's children only if they can see the scan.
create policy engine_calls_select_own on public.engine_calls
  for select to authenticated
  using (exists (select 1 from public.scans s where s.id = scan_id));

create policy answers_select_own on public.answers
  for select to authenticated
  using (exists (select 1 from public.engine_calls ec where ec.id = engine_call_id));

create policy brand_mentions_select_own on public.brand_mentions
  for select to authenticated
  using (exists (select 1 from public.answers an where an.id = answer_id));

create policy citations_select_own on public.citations
  for select to authenticated
  using (exists (select 1 from public.answers an where an.id = answer_id));

create policy credit_ledger_select_own on public.credit_ledger
  for select to authenticated
  using (exists (select 1 from public.accounts a where a.id = account_id and a.owner_id = (select auth.uid())));

-- cited_pages (M-2), spend_daily and answer_cache have no client policies: service role only.
