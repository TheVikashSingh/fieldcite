# FieldCite

See who ChatGPT, Perplexity and Gemini recommend instead of you, and how to get in. Built for software vendors in the field-service market.

- [SPEC.md](SPEC.md): product spec, moats, and the cost-safety rules
- [ACTION_PLAN.md](ACTION_PLAN.md): build plan and estimated release dates
- [docs/research/distribution-strategy-report.md](docs/research/distribution-strategy-report.md): the market research behind this choice

Status: week 1, command-line scanner.

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
