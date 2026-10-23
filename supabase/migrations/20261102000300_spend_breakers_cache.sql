-- Spend rollup, circuit breakers (CS-7), call history (M-1) and the answer cache (CS-10).
--
-- Every engine call is recorded by record_engine_call() in one transaction: the engine_calls
-- row (charged to the scan's reservation by the ledger trigger), its spend_daily rollup, the
-- answer, citations and brand mentions, and a fresh answer_cache entry. check_breakers() runs
-- before every engine call and says whether the call may go ahead.
--
-- All days and months are UTC.

-- Cost settings -------------------------------------------------------------------------

-- One row. The CS-7 limits can be lowered here but never raised above the spec values.
-- The forecasts are config values: change them with an update, no deploy needed.
create table public.cost_settings (
  id boolean primary key default true check (id),
  free_daily_limit_usd numeric(12, 2) not null default 10
    check (free_daily_limit_usd > 0 and free_daily_limit_usd <= 10),
  total_daily_limit_usd numeric(12, 2) not null default 30
    check (total_daily_limit_usd > 0 and total_daily_limit_usd <= 30),
  baseline_monthly_overrun_usd numeric(12, 2) not null default 60
    check (baseline_monthly_overrun_usd >= 0 and baseline_monthly_overrun_usd <= 60),
  -- Expected baseline spend per calendar month (SPEC §7: monthly refresh of public pages).
  baseline_monthly_forecast_usd numeric(12, 2) not null default 18 check (baseline_monthly_forecast_usd >= 0),
  -- Expected total spend per calendar month, for the 50/80/100% alerts (CS-13).
  monthly_forecast_usd numeric(12, 2) not null default 50 check (monthly_forecast_usd > 0),
  updated_at timestamptz not null default now()
);
insert into public.cost_settings default values;

-- spend_daily rollup --------------------------------------------------------------------

-- Spend by account comes from engine_calls joined to scans, so the rollup only keeps the
-- three scan types the breakers need.
alter table public.spend_daily add constraint spend_daily_scope_check check (scope in ('free', 'paid', 'baseline'));
comment on column public.spend_daily.scope is 'Scan type: free, paid or baseline.';

-- Adds each call's cost to spend_daily in the same transaction as the engine_calls row (CS-9),
-- then trips any breaker the new spend reaches, timestamped with this call.
create function public.engine_calls_rollup_spend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
begin
  if new.cost_usd = 0 then
    return null;
  end if;
  select s.type into v_type from public.scans s where s.id = new.scan_id;
  insert into public.spend_daily (day, engine, scope, usd)
    values ((new.created_at at time zone 'UTC')::date, new.engine, v_type, new.cost_usd)
    on conflict (day, engine, scope) do update set usd = public.spend_daily.usd + excluded.usd;
  perform public.trip_breakers(new.created_at);
  return null;
end
$$;

-- Circuit breakers (CS-7) ---------------------------------------------------------------

-- One row per breaker per period it tripped in. A breaker is tripped while a row exists for
-- the current period, so the daily breakers reset at 00:00 UTC and the monthly one on the 1st.
create table public.breaker_trips (
  id bigint generated always as identity primary key,
  breaker text not null check (breaker in ('free_daily', 'total_daily', 'baseline_monthly')),
  period_start date not null,
  tripped_at timestamptz not null,
  spend_usd numeric(12, 6) not null,
  limit_usd numeric(12, 6) not null,
  -- Set when a notifier claims the trip, so each trip is sent once.
  notified_at timestamptz,
  unique (breaker, period_start)
);

-- Spend so far against each breaker's limit, for the periods containing p_at.
--   free_daily        free-scan spend today            >= $10
--   total_daily       all spend today                  >= $30
--   baseline_monthly  baseline spend this month        >= baseline forecast + $60
create function public.breaker_levels(p_at timestamptz)
returns table (breaker text, period_start date, spend_usd numeric, limit_usd numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (select * from public.cost_settings),
  p as (
    select (p_at at time zone 'UTC')::date as day,
           date_trunc('month', p_at at time zone 'UTC')::date as month_start
  )
  select 'free_daily', p.day,
         coalesce((select sum(sd.usd) from public.spend_daily sd where sd.day = p.day and sd.scope = 'free'), 0),
         cfg.free_daily_limit_usd
    from cfg, p
  union all
  select 'total_daily', p.day,
         coalesce((select sum(sd.usd) from public.spend_daily sd where sd.day = p.day), 0),
         cfg.total_daily_limit_usd
    from cfg, p
  union all
  select 'baseline_monthly', p.month_start,
         coalesce((select sum(sd.usd) from public.spend_daily sd
                    where sd.scope = 'baseline' and sd.day >= p.month_start
                      and sd.day < (p.month_start + interval '1 month')::date), 0),
         cfg.baseline_monthly_forecast_usd + cfg.baseline_monthly_overrun_usd
    from cfg, p
$$;

-- Records a trip for every breaker at or over its limit. Safe to call any number of times.
create function public.trip_breakers(p_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.breaker_trips (breaker, period_start, tripped_at, spend_usd, limit_usd)
    select b.breaker, b.period_start, p_at, b.spend_usd, b.limit_usd
      from public.breaker_levels(p_at) b
     where b.spend_usd >= b.limit_usd
    on conflict (breaker, period_start) do nothing
$$;

-- Runs before every engine call. Returns the breaker that blocks this scan's next call, or
-- null if the call may go ahead. A paid scan that started before the $30 breaker tripped is
-- in flight and may finish; every other scan type, and paid scans started later, are paused.
create function public.check_breakers(p_scan_id uuid, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_started_at timestamptz;
  v_blocked text;
begin
  -- Catches spend that crossed a limit across concurrent transactions without tripping.
  perform public.trip_breakers(p_at);

  select s.type, s.started_at into v_type, v_started_at from public.scans s where s.id = p_scan_id;
  if not found then
    raise exception 'scan % not found', p_scan_id using errcode = 'FC006';
  end if;

  select t.breaker into v_blocked
    from public.breaker_trips t
    join public.breaker_levels(p_at) b on b.breaker = t.breaker and b.period_start = t.period_start
   where (t.breaker = 'free_daily' and v_type = 'free')
      or (t.breaker = 'total_daily' and not (v_type = 'paid' and v_started_at < t.tripped_at))
      or (t.breaker = 'baseline_monthly' and v_type = 'baseline')
   order by t.tripped_at
   limit 1;
  return v_blocked;
end
$$;

-- Claims the current periods' trips that nobody has notified yet. Concurrent callers never
-- get the same trip: the second update waits on the row lock, then skips the claimed row.
create function public.claim_breaker_notifications(p_at timestamptz default now())
returns table (breaker text, period_start date, tripped_at timestamptz, spend_usd numeric, limit_usd numeric)
language sql
security definer
set search_path = ''
as $$
  update public.breaker_trips t
     set notified_at = now()
    from public.breaker_levels(p_at) b
   where t.notified_at is null and t.breaker = b.breaker and t.period_start = b.period_start
  returning t.breaker, t.period_start, t.tripped_at, t.spend_usd, t.limit_usd
$$;

-- Breaker state right now: one row per breaker (for the admin console and the daily email).
create view public.breaker_status as
  select b.breaker, b.period_start, b.spend_usd, b.limit_usd,
         t.tripped_at is not null as tripped, t.tripped_at, t.notified_at
    from public.breaker_levels(now()) b
    left join public.breaker_trips t on t.breaker = b.breaker and t.period_start = b.period_start;

-- Call history (M-1) and the answer cache (CS-10) -----------------------------------------

-- A cache hit stores its own answer row for history, pointing at the answer it reused.
alter table public.answers add column cached_from_answer_id uuid references public.answers (id) on delete set null;

-- Records one engine call and everything it produced, atomically. p is a JSON object:
--   scan_id, engine, model, question_text, run, input_tokens, output_tokens, search_calls,
--   cost_usd, latency_ms, attempts, status ('ok' | 'error'), error, cache_hit, created_at,
--   answer:    { text, raw, cached_from_answer_id }        (ok calls only)
--   citations: [{ url, title, domain, position }]
--   mentions:  [{ brand, domain, position }]              (brands without a domain are skipped)
--   cache:     { model, hash }                            (fresh ok answers: reuse for 72 h)
create function public.record_engine_call(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce((p ->> 'created_at')::timestamptz, now());
  v_call_id uuid;
  v_answer_id uuid;
  v_brand_id uuid;
  c record;
  m record;
begin
  insert into public.engine_calls
      (scan_id, engine, model, question_text, run, input_tokens, output_tokens, search_calls,
       cost_usd, latency_ms, attempts, status, error, cache_hit, created_at)
    values ((p ->> 'scan_id')::uuid, p ->> 'engine', p ->> 'model', p ->> 'question_text',
            coalesce((p ->> 'run')::integer, 1), coalesce((p ->> 'input_tokens')::integer, 0),
            coalesce((p ->> 'output_tokens')::integer, 0), coalesce((p ->> 'search_calls')::integer, 0),
            coalesce((p ->> 'cost_usd')::numeric, 0), coalesce((p ->> 'latency_ms')::integer, 0),
            coalesce((p ->> 'attempts')::integer, 0), p ->> 'status', p ->> 'error',
            coalesce((p ->> 'cache_hit')::boolean, false), v_at)
    returning id into v_call_id;

  if p ->> 'status' <> 'ok' or jsonb_typeof(p -> 'answer') is distinct from 'object' then
    return v_call_id;
  end if;

  insert into public.answers (engine_call_id, text, raw, cached_from_answer_id, created_at)
    values (v_call_id, coalesce(p -> 'answer' ->> 'text', ''), p -> 'answer' -> 'raw',
            (p -> 'answer' ->> 'cached_from_answer_id')::uuid, v_at)
    returning id into v_answer_id;

  for c in
    select * from jsonb_to_recordset(coalesce(p -> 'citations', '[]')) as x(url text, title text, domain text, position integer)
  loop
    insert into public.cited_pages (url, domain) values (c.url, coalesce(c.domain, ''))
      on conflict (url) do nothing;
    insert into public.citations (answer_id, url, title, position, cited_page_id, created_at)
      select v_answer_id, c.url, c.title, c.position, cp.id, v_at
        from public.cited_pages cp where cp.url = c.url;
  end loop;

  for m in
    select * from jsonb_to_recordset(coalesce(p -> 'mentions', '[]')) as x(brand text, domain text, position integer)
  loop
    continue when m.domain is null or m.domain = '';
    insert into public.brands (name, domain) values (m.brand, m.domain)
      on conflict ((lower(domain))) where domain is not null do nothing;
    select b.id into v_brand_id from public.brands b where lower(b.domain) = lower(m.domain);
    insert into public.brand_mentions (answer_id, brand_id, position, created_at)
      values (v_answer_id, v_brand_id, m.position, v_at);
  end loop;

  -- CS-10: only fresh answers enter the cache, so a hit never extends its own lifetime.
  if jsonb_typeof(p -> 'cache') = 'object' and not coalesce((p ->> 'cache_hit')::boolean, false) then
    insert into public.answer_cache (engine, model, normalized_question_hash, answer_id, expires_at, created_at)
      values (p ->> 'engine', p -> 'cache' ->> 'model', p -> 'cache' ->> 'hash', v_answer_id,
              v_at + interval '72 hours', v_at)
      on conflict (engine, model, normalized_question_hash) do update
        set answer_id = excluded.answer_id, expires_at = excluded.expires_at, created_at = excluded.created_at;
  end if;

  return v_call_id;
end
$$;

-- The cached answer for a key, if it has not expired at p_at.
create function public.answer_cache_lookup(p_engine text, p_model text, p_hash text, p_at timestamptz default now())
returns table (answer_id uuid, text text, model text, citations jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select an.id, an.text, ec.model,
         coalesce((select jsonb_agg(jsonb_build_object('url', ci.url, 'title', ci.title) order by ci.position)
                     from public.citations ci where ci.answer_id = an.id), '[]')
    from public.answer_cache ac
    join public.answers an on an.id = ac.answer_id
    join public.engine_calls ec on ec.id = an.engine_call_id
   where ac.engine = p_engine and ac.model = p_model and ac.normalized_question_hash = p_hash
     and ac.expires_at > p_at
$$;

create trigger engine_calls_rollup_spend
  after insert on public.engine_calls
  for each row execute function public.engine_calls_rollup_spend();

-- Access --------------------------------------------------------------------------------

-- Service role only. Supabase's default privileges grant new objects to anon and
-- authenticated, so revoke them explicitly.
alter table public.cost_settings enable row level security;
alter table public.breaker_trips enable row level security;
revoke all on public.cost_settings, public.breaker_trips, public.breaker_status from public, anon, authenticated;
grant all on public.cost_settings, public.breaker_trips, public.breaker_status to service_role;

revoke all on function public.engine_calls_rollup_spend() from public, anon, authenticated;
revoke all on function public.breaker_levels(timestamptz) from public, anon, authenticated;
revoke all on function public.trip_breakers(timestamptz) from public, anon, authenticated;
revoke all on function public.check_breakers(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_breaker_notifications(timestamptz) from public, anon, authenticated;
revoke all on function public.record_engine_call(jsonb) from public, anon, authenticated;
revoke all on function public.answer_cache_lookup(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.breaker_levels(timestamptz) to service_role;
grant execute on function public.trip_breakers(timestamptz) to service_role;
grant execute on function public.check_breakers(uuid, timestamptz) to service_role;
grant execute on function public.claim_breaker_notifications(timestamptz) to service_role;
grant execute on function public.record_engine_call(jsonb) to service_role;
grant execute on function public.answer_cache_lookup(text, text, text, timestamptz) to service_role;
