# FieldCite

See who ChatGPT, Perplexity and Gemini recommend instead of you, and how to get in. Built for software vendors in the field-service market.

- [SPEC.md](SPEC.md): product spec, moats, and the cost-safety rules
- [ACTION_PLAN.md](ACTION_PLAN.md): build plan and estimated release dates
- [docs/research/distribution-strategy-report.md](docs/research/distribution-strategy-report.md): the market research behind this choice

Status: week 2, data model and credit ledger.

## Development

Needs Node.js 22.12 or later.

```bash
npm install
npm run lint && npm run typecheck && npm test
```

## Scanner

A dry run uses synthetic fixture responses (`fixtures/engines/`), makes no API calls and costs nothing:

```bash
npm run scan -- --category pest-control --country US --questions 5 --runs 1 --engines openai,perplexity,gemini --dry-run
```

Reports are written as JSON and Markdown to `out/`, which is gitignored. Never commit scan results (SPEC M-2).

For a real run, copy `.env.example` to `.env`, add the API keys, and add `--confirm`. Without `--confirm` the tool only prints the plan and its worst-case cost. Safety rules built in (SPEC §9):

- at most 150 calls per scan (CS-5); larger plans are refused;
- 60 s timeout per call and at most 2 retries, only on 429/5xx or network errors (CS-5);
- output capped at 1,200 tokens per answer (CS-6);
- `SCANS_ENABLED=false` stops all new engine calls, including mid-scan (CS-8);
- every call's cost comes from the pricing table in `src/engines/pricing.ts` (CS-9).

Categories (brands and question sets) live in `data/categories/<slug>.json`.

## Database

The schema (SPEC §6.2) is plain SQL in `supabase/migrations/`, with row-level security on every table. It runs on Supabase (`supabase db push`) or on any Postgres 15+, so no Supabase account is needed for development.

The credit ledger lives in Postgres functions (`supabase/migrations/*_credit_ledger.sql`), called from `src/ledger/`:

- `reserve_scan` reserves a scan's full call budget in one transaction and rejects it if the balance is too low (CS-4);
- it also refuses a second running scan for the same account and budgets above 150 calls (CS-5);
- each `engine_calls` row is charged to the reservation, and calls past it are refused;
- `finish_scan` refunds the unused calls, once.

`runScan` takes an optional `storage` (`PgScanStorage` in `src/ledger/scan-storage.ts`) to write each call's cost to `engine_calls` (CS-9). The CLI doesn't use one, so it still runs without a database.

### Database tests

The concurrency tests in `src/ledger/ledger.db.test.ts` need a real Postgres. They are skipped when `DATABASE_URL` is unset and only run against `localhost`. CI runs them in the `db-test` job. To run them locally with Docker:

```bash
docker run -d --name fieldcite-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
export DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres
npm run db:migrate
npm run test:db
```

On PowerShell, set the variable with `$env:DATABASE_URL = "postgres://postgres:postgres@localhost:55432/postgres"`. Remove the container with `docker rm -f fieldcite-pg`.
