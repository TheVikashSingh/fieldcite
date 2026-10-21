# FieldCite: notes for Claude sessions

- Read `SPEC.md` (product, moats, cost-safety rules) and `ACTION_PLAN.md` (current week) before starting work.
- Niche: AI-answer visibility for **field-service software vendors** (US/UK/CA/AU). Fallback niche: clinic/practice software.
- **Cost safety is non-negotiable** (SPEC §9, CS-1 to CS-14). Every paid API call goes through the engine adapter → credit ledger → circuit breaker path, with timeouts, max tokens and bounded retries. Never add an unlimited plan or a user-controlled call count.
- Use official engine APIs only. Never scrape the AI apps or put API keys in client code.
- The user is on Claude Pro with tight weekly limits: keep sessions to one feature, avoid large multi-agent runs, and keep web searches to a minimum.
- Work on a branch and open a PR; CI (markdown lint, spec guard, secret scan) must pass before merging. Auto-merge is not set up yet: native auto-merge needs GitHub Pro or a public repo.
- Background research lives in `docs/research/distribution-strategy-report.md`.
