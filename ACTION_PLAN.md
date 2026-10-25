# FieldCite: Action Plan to First Release

> Assumptions: solo builder, **about 20 hours/week**, Claude Pro for writing code (rate limits included), about **$50–100** of API credit before revenue. Start date: **Wed 2026-10-21**.
>
> All IDs (F-x, M-x, CS-x) refer to [SPEC.md](SPEC.md).

## Estimated completion

| Milestone | What ships | Target date | Range (best / likely / worst) |
|---|---|---|---|
| **M0: Niche validated** | Vertical test scored, accounts and merchant of record chosen | **Sun 2026-10-25** | Oct 24 / Oct 25 / Oct 28 |
| **M1: Scanner works** | Command-line scanner, 3 engines, cost logging, first real FSM category report | **Sun 2026-11-01** | Oct 31 / Nov 1 / Nov 5 |
| **M2: Private beta** | Free scan (F-1), report (F-2), fix list (F-3), all cost-safety rules CS-1 to CS-14 live, 10 public pages | **Sun 2026-11-22** | Nov 19 / Nov 22 / Dec 2 |
| **M3: v1.0 paid release** | Billing (F-7), weekly tracking (F-4), digest (F-5), 20 public pages (F-6), admin console (F-8), public launch | **Sun 2026-12-06** | Nov 29 / Dec 6 / Dec 20 |

**Total effort estimate:** about 120–140 hours. The biggest risk to the schedule is Claude Pro rate limits. Mitigate them with small, single-feature sessions and a spec-first `CLAUDE.md`.

**Hard external date:** Gemini Flash prices reportedly double on **2027-01-01**. Revisit the pricing table (CS-9) and plan margins before then.

---

## Week 0: Validate the niche and set up accounts

*Oct 21–25 · about 8 h*

- [ ] **Vertical test (2 h, $0, no Claude needed).** Run the 5 FSM questions below in ChatGPT (search on) and Perplexity. For each answer, log the brands named, the cited URLs and the page type in a sheet.
  - "best scheduling and invoicing software for a small HVAC company"
  - "Jobber alternatives for a 3-person cleaning business"
  - "best field service software for pest control UK"
  - "cheapest quoting app for a solo landscaper"
  - "Housecall Pro vs Jobber for plumbers"
- [ ] Score FSM from 0 to 2 on each of five criteria (10 points total): answer concentration, winnable cited pages, prospect density (30+ vendors), value per customer ($1K+/yr), reachability. **6 or more → proceed. Below 6 → rerun with clinic software (SPEC §2.2).**
- [ ] Count prospects: list 40 mid-tier vendors with domains from Capterra/G2 FSM categories. This seeds `brands`.
- [ ] Pick a merchant of record (Paddle / Lemon Squeezy / Polar / Dodo) after confirming India seller support and fees. (SPEC §12 Q1)
- [ ] Set up accounts: OpenAI and Perplexity with **prepaid credits and auto-recharge OFF (CS-1)**, a Gemini Google Cloud project with **no billing attached (CS-2)**, plus Supabase, Vercel, Resend and Turnstile.
- [ ] Reserve a domain (about $10–15).

**Exit:** niche decision recorded in SPEC §2.2; all accounts created; no card on any postpaid AI billing.

## Week 1: Scanner as a command-line tool (M1)

*Oct 26 – Nov 1 · about 20 h*

- [x] Scaffold the Next.js + TypeScript repo with lint, typecheck and test scripts in CI.
- [x] Engine adapters (SPEC §6.1) for OpenAI web_search, Perplexity Sonar and Gemini grounding, with timeouts (CS-5) and max tokens (CS-6).
- [x] Pricing table in code plus cost per call (CS-9). Write unit tests against the official price pages.
- [x] Brand extraction (alias list + cheap model) and page-type classification for citations. The cheap-model fallback is an interface for now; wire a nano model through the adapter + ledger path in week 2.
- [x] Command-line tool: `scan --category pest-control-us --questions 10 --runs 1` outputs a JSON and Markdown report.
- [ ] Run it on 1 real FSM category, check extraction accuracy by hand (target: 90%+ correct brand matches), and fix.

**Exit:** a report you'd publish; the exact cost of the run logged and matching the provider dashboards to within 10%.

## Week 2: Data model, credit ledger, cost safety core

*Nov 2–8 · about 22 h*

- [x] Supabase schema (SPEC §6.2) with migrations and row-level security.
- [x] Store every call, answer, mention and citation (M-1). Set up the `cited_pages` table (M-2).
- [x] **Credit ledger with atomic reservation (CS-4)**, including concurrency tests (two scans racing for the last credits).
- [x] Hard per-scan limits, 1 running scan per account, retry policy (CS-5).
- [x] `spend_daily` rollup, **circuit breakers (CS-7)**, **kill switch (CS-8)**, daily spend email (CS-9, CS-13). The email body is built behind a notifier interface; sending it needs Resend (week 3+).
- [x] Answer cache (CS-10).
- [ ] Background job runner (Trigger.dev or Inngest) running scans.

**Exit:** tests prove a scan can't exceed its reservation, breakers trip at the thresholds, and the kill switch stops calls in under 60 s.

## Week 3: Free scan, report and fix list

*Nov 9–15 · about 22 h*

- [ ] Landing page and free-scan form (F-1) with Turnstile, email verification and the abuse rules (CS-11).
- [x] Report page (F-2): share of voice, per-question answers, citations, gaps view, method and disclaimer (SPEC §8). Served at `/r/<share token>` from Postgres (`scan_reports`, token stored hashed) and at `/r/demo` from the fixtures; saving a report when a scan finishes comes with the job runner.
- [x] Fix-list generator (F-3) using FSM templates (M-4), with every action linked to stored evidence. The gaps view data (F-2) and `--brand` on the scan CLI come with it; any LLM rewording sits behind an interface capped at 1,500 output tokens (CS-6) and is not wired up yet.
- [x] Cited-page enrichment (M-2): polite fetch, robots.txt respected, submission/affiliate/contact detection. `npm run enrich -- --from <scan report> [--limit N] [--dry-run]` fills only empty `cited_pages` fields (curator edits are kept); running it on real reports waits for a database and the job runner.
- [ ] Magic-link login (F-9).

**Exit:** a stranger can get a free scan report in under 3 minutes with no help.

## Week 4: Public pages, load test, private beta (M2)

*Nov 16–22 · about 20 h*

- [ ] Baseline scan job (M-1) for 10 public FSM categories, refreshed monthly.
- [ ] Public category pages (F-6, M-3): SEO metadata, structured tables, date stamps, method notes, a free-scan prompt on each.
- [ ] **Load test (CS-14)** with mocked engines: 100 simultaneous free scans plus 10 paid scans.
- [ ] Privacy policy, terms of service, data-deletion flow (SPEC §10).
- [ ] **Private beta:** 20 proof-first written emails to vendors from the week-0 list, each with their own snapshot, inviting them to a free full scan.

**Exit:** 10 public pages live, at least 5 beta scans by real vendors, and every CS-x invariant has a passing check.

## Week 5: Billing, tracking and digest

*Nov 23–29 · about 20 h*

- [ ] Merchant-of-record checkout (F-7): Starter at $49 and Growth at $149, with upgrades and cancellation.
- [ ] Plan quotas wired to the credit ledger (CS-3, CS-4).
- [ ] Weekly re-scan jobs, history charts, new/lost citation alerts (F-4).
- [ ] Weekly digest email (F-5).
- [ ] Admin console (F-8): spend, breakers, kill switch, action-database curation UI.

**Exit:** a test purchase in the merchant of record's sandbox gets the paid plan, scheduled weekly scans run, and the digest arrives.

## Week 6: Public launch (M3, v1.0)

*Nov 30 – Dec 6 · about 16 h*

- [ ] Grow to 20 public category pages.
- [ ] Turn on live payments; first real top-up of prepaid credits, sized to ≤2 weeks of spend (CS-1).
- [ ] Launch posts, all written: Show HN, Indie Hackers, X and LinkedIn build-in-public threads, SaaS directories.
- [ ] Proof-first outreach: 10–15 personalized emails a day to mid-tier FSM vendors, each with a snapshot of their gap and a link to a free scan.
- [ ] Set up a metrics sheet for the SPEC §11 targets.

**Exit:** v1.0 live, with payments on and weekly metrics tracked.

---

## After launch (weeks 7–14): reaching the SPEC §11 targets

| Week | Focus |
|---|---|
| 7–8 | Outreach and onboarding fixes. Goal: 100 free scans and the first 1–3 paying customers. |
| 9–10 | Improve the fix list based on what customers actually act on. Curate the action database (M-2). |
| 11–12 | Check that public pages bring scans without outreach (M-3). Consider weekly baseline refreshes once revenue is above $500/mo. |
| 13–14 | v1.1 candidates: agency white-label at $299, Google AI Mode via a paid SERP API, comparison-page drafts. |

## Working rules

1. **Spec first.** Change SPEC.md in a pull request before building anything that contradicts it.
2. **Every pull request passes CI:** markdown lint, spec guard (all CS-x/M-x IDs still present), secret scan, and later lint, typecheck and tests. `main` is protected, and PRs auto-merge only when every check is green.
3. **No new engine call path without a cost test.** Any code that calls a paid API must go through the adapter + ledger + breaker path.
4. **Claude Pro budget:** one feature per session; start each session by reading `CLAUDE.md`, and don't run big multi-agent jobs.
