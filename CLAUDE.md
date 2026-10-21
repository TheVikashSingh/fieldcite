# FieldCite: notes for Claude sessions

- Read `SPEC.md` (product, moats, cost-safety rules) and `ACTION_PLAN.md` (current week) before starting work.
- Niche: AI-answer visibility for **field-service software vendors** (US/UK/CA/AU). Fallback niche: clinic/practice software.
- **Cost safety is non-negotiable** (SPEC §9, CS-1 to CS-14). Every paid API call goes through the engine adapter → credit ledger → circuit breaker path, with timeouts, max tokens and bounded retries. Never add an unlimited plan or a user-controlled call count.
- Use official engine APIs only. Never scrape the AI apps or put API keys in client code.
- The user is on Claude Pro with tight weekly limits: keep sessions to one feature, avoid large multi-agent runs, and keep web searches to a minimum.
- Work on a branch and open a PR; `main` is protected: CI (markdown lint, spec guard, secret scan) must pass, and PRs then auto-merge by squash (`gh pr merge --auto --squash`).
- The repo is **public**. Never commit secrets, customer data, scan results, or the action database (SPEC M-2). Those belong in Supabase only. Commit with the GitHub noreply email (already set in this repo's git config).
- Background research lives in `docs/research/distribution-strategy-report.md`.
