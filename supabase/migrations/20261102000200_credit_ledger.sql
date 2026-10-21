-- Credit ledger with atomic reservation (CS-4) and per-scan limits (CS-5).
--
-- 1 credit = 1 engine call. A scan reserves its full call budget before it starts and
-- gets the unused calls back when it finishes. Every balance change locks the account
-- row first, so concurrent reservations for one account run one after the other.
--
-- Errors use custom SQLSTATEs so the TypeScript wrapper (src/ledger) can map them:
--   FC001 insufficient credits      FC002 a scan is already running for the account
--   FC003 call budget out of range  FC004 scan is not running
--   FC005 reservation used up       FC006 account or scan not found

create function public.grant_credits(p_account_id uuid, p_amount integer, p_reason text default 'grant')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_balance integer;
begin
  if p_reason not in ('grant', 'adjust') then
    raise exception 'grant_credits: reason must be grant or adjust, got %', p_reason using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 0 or (p_reason = 'grant' and p_amount < 0) then
    raise exception 'grant_credits: invalid amount %', p_amount using errcode = '22023';
  end if;

  select a.credit_balance into v_balance from public.accounts a where a.id = p_account_id for update;
  if not found then
    raise exception 'account % not found', p_account_id using errcode = 'FC006';
  end if;
  if v_balance + p_amount < 0 then
    raise exception 'insufficient credits: balance %, adjustment %', v_balance, p_amount using errcode = 'FC001';
  end if;

  v_balance := v_balance + p_amount;
  update public.accounts set credit_balance = v_balance where id = p_account_id;
  insert into public.credit_ledger (account_id, delta, reason, balance_after)
    values (p_account_id, p_amount, p_reason, v_balance);
  return v_balance;
end
$$;

-- Starts a scan: reserves p_calls credits and creates the scan row in one transaction.
create function public.reserve_scan(
  p_account_id uuid,
  p_type text,
  p_calls integer,
  p_category_id uuid default null,
  p_country text default null
)
returns table (scan_id uuid, balance_after integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_balance integer;
  v_scan_id uuid;
begin
  if p_type not in ('free', 'paid') then
    raise exception 'reserve_scan: type must be free or paid, got %', p_type using errcode = '22023';
  end if;
  -- CS-5: at most 150 calls per scan.
  if p_calls is null or p_calls < 1 or p_calls > 150 then
    raise exception 'call budget must be from 1 to 150, got %', p_calls using errcode = 'FC003';
  end if;

  -- The lock that makes reservations atomic: a second reservation for this account
  -- waits here until the first one commits, then sees the new balance and scan.
  select a.credit_balance into v_balance from public.accounts a where a.id = p_account_id for update;
  if not found then
    raise exception 'account % not found', p_account_id using errcode = 'FC006';
  end if;

  -- CS-4: reject the scan if the balance can't cover its full budget.
  if v_balance < p_calls then
    raise exception 'insufficient credits: balance %, scan needs %', v_balance, p_calls using errcode = 'FC001';
  end if;

  -- CS-5: at most 1 running scan per account.
  if exists (select 1 from public.scans s where s.account_id = p_account_id and s.status = 'running') then
    raise exception 'a scan is already running for account %', p_account_id using errcode = 'FC002';
  end if;

  v_balance := v_balance - p_calls;
  update public.accounts set credit_balance = v_balance where id = p_account_id;
  insert into public.scans (account_id, category_id, country, type, status, calls_reserved)
    values (p_account_id, p_category_id, p_country, p_type, 'running', p_calls)
    returning id into v_scan_id;
  insert into public.credit_ledger (account_id, delta, reason, scan_id, balance_after)
    values (p_account_id, -p_calls, 'reserve', v_scan_id, v_balance);

  return query select v_scan_id, v_balance;
end
$$;

-- Ends a running scan and refunds the calls it reserved but did not use.
create function public.finish_scan(p_scan_id uuid, p_status text default 'completed')
returns table (calls_used integer, refunded integer, balance_after integer, cost_usd numeric)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_account_id uuid;
  v_scan public.scans%rowtype;
  v_refund integer;
  v_balance integer;
begin
  if p_status not in ('completed', 'failed', 'cancelled') then
    raise exception 'finish_scan: status must be completed, failed or cancelled, got %', p_status using errcode = '22023';
  end if;

  select s.account_id into v_account_id from public.scans s where s.id = p_scan_id;
  if not found then
    raise exception 'scan % not found', p_scan_id using errcode = 'FC006';
  end if;

  -- Same lock order as reserve_scan (account, then scan) so the two can't deadlock.
  if v_account_id is not null then
    select a.credit_balance into v_balance from public.accounts a where a.id = v_account_id for update;
  end if;
  select * into v_scan from public.scans s where s.id = p_scan_id for update;
  -- Finishing twice would refund twice.
  if v_scan.status <> 'running' then
    raise exception 'scan % is not running (status %)', p_scan_id, v_scan.status using errcode = 'FC004';
  end if;

  update public.scans set status = p_status, finished_at = now() where id = p_scan_id;

  v_refund := case when v_account_id is null then 0 else v_scan.calls_reserved - v_scan.calls_used end;
  if v_refund > 0 then
    v_balance := v_balance + v_refund;
    update public.accounts set credit_balance = v_balance where id = v_account_id;
    insert into public.credit_ledger (account_id, delta, reason, scan_id, balance_after)
      values (v_account_id, v_refund, 'refund', p_scan_id, v_balance);
  end if;

  return query select v_scan.calls_used, v_refund, v_balance, v_scan.cost_usd;
end
$$;

-- Every engine call row uses one reserved call and adds its cost to the scan (CS-4, CS-9).
-- The conditional update takes the scan's row lock, so concurrent inserts can't overrun
-- the reservation, and nothing can be recorded once the scan has finished. Cache hits use
-- a slot too: the reservation counts planned calls, not dollars.
create function public.engine_calls_charge_scan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.scans s
    set calls_used = s.calls_used + 1, cost_usd = s.cost_usd + new.cost_usd
    where s.id = new.scan_id and s.status = 'running' and s.calls_used < s.calls_reserved;
  if not found then
    if exists (select 1 from public.scans s where s.id = new.scan_id and s.status = 'running') then
      raise exception 'scan % has used all its reserved calls', new.scan_id using errcode = 'FC005';
    end if;
    raise exception 'scan % is not running', new.scan_id using errcode = 'FC004';
  end if;
  return new;
end
$$;

create trigger engine_calls_charge_scan
  before insert on public.engine_calls
  for each row execute function public.engine_calls_charge_scan();

-- Ledger rows are never edited. (Deletes stay possible so account deletion can cascade.)
create function public.credit_ledger_no_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'credit_ledger is append-only' using errcode = '42501';
end
$$;

create trigger credit_ledger_no_update
  before update on public.credit_ledger
  for each row execute function public.credit_ledger_no_update();

-- Only the server (service role) may move credits. Clients can't call these at all.
revoke all on function public.grant_credits(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.reserve_scan(uuid, text, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_scan(uuid, text) from public, anon, authenticated;
revoke all on function public.engine_calls_charge_scan() from public, anon, authenticated;
revoke all on function public.credit_ledger_no_update() from public, anon, authenticated;
grant execute on function public.grant_credits(uuid, integer, text) to service_role;
grant execute on function public.reserve_scan(uuid, text, integer, uuid, text) to service_role;
grant execute on function public.finish_scan(uuid, text) to service_role;
