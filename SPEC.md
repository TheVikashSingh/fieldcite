# FieldCite: Product Spec (v1)

> **Working name:** FieldCite. **Status:** pre-build. **Owner:** Vikash Singh. **Last updated:** 2026-10-21.
>
> FieldCite shows software vendors in the field-service market who ChatGPT, Perplexity and Gemini recommend instead of them, which pages those answers come from, and exactly what to do to get in.

---

## 1. Summary

Home-service businesses such as HVAC, plumbing, cleaning, pest control and landscaping companies increasingly ask AI assistants questions like "what's the best scheduling and invoicing software for a 3-person plumbing company?" The answers recommend a few vendors and cite a few pages. Most mid-tier vendors don't know whether they're in those answers, why not, or how to fix it.

FieldCite is a **self-serve SaaS** that:

1. runs the questions these buyers actually ask through AI answer engines, using official APIs only;
2. measures each vendor's **share of voice** against named competitors;
3. lists every **page the engines cite**, labels its type, and flags where competitors appear but the customer doesn't;
4. produces a **ranked fix list** with concrete placement opportunities: who owns the page, how to get listed, and whether an affiliate or sponsorship option exists;
5. tracks all of it weekly, so customers see movement over time.

**Sales are no-call by design.** Buyers find us through free public category pages and proof-first written outreach, run a free scan, and pay by card through a merchant of record.

## 2. Niche and ideal customer

### 2.1 Niche: field-service software (FSM) vendors

- **Who pays:** B2B SaaS vendors whose customers are trade and field-service businesses. That covers horizontal FSM suites and trade-specific tools (pest control, pool service, cleaning, HVAC, plumbing, electrical, roofing, landscaping, lawn care, appliance repair, locksmith).
- **Markets:** vendors selling into the **US, UK, Canada and Australia**.
- **Ideal customer:** mid-tier vendors, roughly ranked 5th to 50th in their category. Typical signals: a public pricing page at $30/user/month or more (or similar), 50+ reviews on Capterra or G2, and 5–200 staff. The buyer is the founder, the head of marketing, or a solo growth marketer. The category leaders (ServiceTitan, Jobber, Housecall Pro) are *not* the ideal customer. They are the benchmark the customer wants to beat.

### 2.2 Why this niche (hypothesis, validated in week 0)

| Criterion | Why FSM looks strong (to be confirmed) |
|---|---|
| Value per customer | Field-service software often costs $600–6,000+ per customer per year. One extra customer won through AI answers pays for many months of FieldCite. |
| Many winnable questions | Trade × team size × country × job ("quoting app for a solo window cleaner in the UK") yields hundreds of specific questions. Many are answered from thin listicles that can be won. |
| Vendors with budget | Many mid-tier vendors sit behind a few leaders, so there are lots of prospects with marketing spend. |
| Low AEO sophistication | Mid-tier vertical-SaaS marketing teams rarely run AI-answer programs today. |
| Few competitors with a vertical focus | AEO tools are horizontal. None is built for this vertical (checked again in week 0). |

**Result (2026-10-21): FSM scored 8/10. Proceed.** Details are in [docs/week0-vertical-test.md](docs/week0-vertical-test.md).

**Validation gate (week 0):** run the vertical test in [ACTION_PLAN.md](ACTION_PLAN.md#week-0--validate-the-niche-and-set-up-accounts) and score FSM from 0 to 10. A score of 6 or more means proceed. Below 6, switch to the fallback niche, **clinic and practice software** (physio, chiro, therapy, dental), and rerun the test.

## 3. The problem and our promise

- **Problem:** "We don't know whether AI assistants recommend us, why competitors get picked, or what to do about it, and we have no time to research it."
- **Promise:** "In 5 minutes, see exactly which AI answers pick your competitors over you, the pages behind those answers, and a ranked list of placements to win this month. Then track your progress every week."
- **What we do NOT promise:** guaranteed rankings or recommendations. AI answers vary from run to run, so we promise measurement and a clear plan of action.

## 4. Moats (built from day 1, not later)

The scanner code itself is easy to copy. Each moat below compounds only if we collect from launch, so each one is a **v1 requirement**.

| ID | Moat | v1 requirement |
|---|---|---|
| M-1 | **History that can't be backfilled** | Store *every* engine answer, brand mention and citation with a timestamp, forever (raw answer text kept 180 days, structured data kept forever). Run a weekly **baseline scan** of every public category even when no customer is subscribed, so the time series starts now. |
| M-2 | **Action database** | Every cited URL becomes a row in `cited_pages`, enriched with: page type, owner or publisher, submission or contact URL, whether an affiliate program exists, a sponsorship price if public, and the outcome of past outreach. Add an admin UI to curate it. This curated data is the core asset. |
| M-3 | **Owning the public category pages** | Public "Who AI recommends for [trade] software, [month year]" pages with clean structure (tables, dates, method notes) so they rank on Google *and* get cited by AI engines. Every page ends with a free-scan prompt. |
| M-4 | **Vertical templates** | Question sets, fix-list templates and comparison-page outlines written specifically for field-service buyers, such as dispatching, quoting, invoicing, route planning and payments. Generic tools can't match this. |
| M-5 | **Switching cost** | Weekly history charts and a digest email the customer forwards to their boss. Data export is allowed, so nobody is locked in, but history only exists here. |

## 5. v1 scope (first public release)

### 5.1 Features

| ID | Feature | Acceptance criteria |
|---|---|---|
| F-1 | **Free scan** | Email + domain + category + up to 3 competitors. 5 questions × 3 engines × 1 run (15 calls). Report ready in under 3 minutes. Abuse controls per CS-11. |
| F-2 | **Report page** | Share of voice per brand per engine; question-by-question answers with brand positions; every cited URL with its page type; a "gaps" view (pages that cite competitors and not you). Shareable private link. Method and disclaimer box (§8). |
| F-3 | **Fix list** | 5–15 ranked actions, each tied to evidence, e.g. "Get listed on [page] (cited in 4/15 answers; mentions Jobber and Workiz; submission form: [url])". Generated from data plus M-4 templates by a cheap LLM, with every claim linked to a stored citation. |
| F-4 | **Paid tracking** | Weekly re-scan of the plan's question set (§7). History charts for share of voice and new or lost citations. Alerts when a competitor appears in a newly cited page. |
| F-5 | **Weekly digest email** | Changes since last week, top 3 actions, and a link to the report. |
| F-6 | **Public category pages** | About 20 pages at launch (e.g. "pest control software", "pool service software", "HVAC software UK"). Refreshed monthly. Built from the baseline scans (M-1). |
| F-7 | **Billing** | Checkout through a merchant of record (MoR), with plans and upgrades. Cancelling stops scans at the end of the billing period. |
| F-8 | **Admin: cost and data console** | Daily spend per engine, per user and per scan type; circuit-breaker state; kill-switch status; action-database curation UI (M-2). |
| F-9 | **Accounts** | Email magic-link login. One user per account in v1. |

### 5.2 Out of scope for v1

Google AI Mode (needs a paid third-party SERP API), Claude, Copilot, team seats, an agency white-label tier (planned for v1.1 at $299/mo), CRM or Slack integrations, automatic fixes, done-for-you placement services, languages other than English, mobile apps.

## 6. Architecture

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js (App Router) + TypeScript** on Vercel (free tier to start) | One language end to end; fast to build with Claude Code |
| Database and login | **Supabase** Postgres (free tier); login is our own magic-link flow (one-time tokens stored as hashes in Postgres, a signed session cookie, email through **Resend**) | Managed Postgres with row-level security. Own login instead of Supabase Auth so it runs and is tested on plain Postgres in CI, with no Supabase account needed to develop |
| Background jobs | **Trigger.dev** or **Inngest** (free tier) | Scans run as jobs with retries, timeouts and concurrency limits |
| Email | **Resend** (free tier) | Digests, alerts, magic links |
| Bot protection | **Cloudflare Turnstile** | Protects the free scan |
| Billing | **Merchant of record**: Paddle, Lemon Squeezy, Polar or Dodo Payments (pick in week 0 after checking India seller support) | Handles foreign cards, VAT and sales tax, and payouts to India |
| Engines | Adapters for **OpenAI Responses API + web_search** (mini/nano model), **Perplexity Sonar**, **Gemini + Google Search grounding** | Official APIs that return citations |

### 6.1 Engine adapter contract

```ts
interface EngineAdapter {
  id: "openai" | "perplexity" | "gemini";
  // Must enforce CS-5 timeouts and CS-6 max output tokens internally.
  ask(question: string, opts: { maxOutputTokens: number; timeoutMs: number }): Promise<{
    text: string;
    citations: { url: string; title?: string }[];
    usage: { inputTokens: number; outputTokens: number; searchCalls: number };
    costUsd: number;      // computed from a pricing table in code; see CS-9
    model: string;
    raw: unknown;         // stored for M-1
  }>;
}
```

### 6.2 Core data model (Postgres)

- `accounts`, `subscriptions` (plan, period, status)
- `categories` (slug, trade, country, is_public)
- `brands` (name, domain, aliases[], category_ids[])
- `questions` (category_id, text, intent tag, source: template, generated or user)
- `scans` (account_id or null for baseline, type: free, paid or baseline, status, calls_reserved, calls_used, cost_usd)
- `engine_calls` (scan_id, engine, model, question_id, input and output tokens, search_calls, cost_usd, latency_ms, status, error, cache_hit)
- `answers` (engine_call_id, text, created_at), `brand_mentions` (answer_id, brand_id, position, sentiment)
- `citations` (answer_id, url, cited_page_id)
- `cited_pages`, the **action database** (url, domain, page_type, publisher, contact_url, submission_url, sponsorship_url, affiliate_program, sponsorship_price, brands_mentioned[], last_fetched_at, curator_notes, outreach_outcome)
- `credit_ledger` (account_id, delta, reason, scan_id, balance_after), `spend_daily` (date, engine, scope, usd)
- `answer_cache` (engine, model, normalized_question_hash, answer_id, expires_at); the hash covers the normalized question, country and run number
- `cost_settings` (breaker limits and forecasts), `breaker_trips` and the `breaker_status` view (CS-7)

## 7. Plans, quotas and unit economics

Every plan is a **fixed monthly API-call budget**. There are no unlimited plans (CS-3).

| Plan | Price | Categories | Questions | Runs | Calls/month (max) | API cost est.* | Gross margin est. |
|---|---|---|---|---|---|---|---|
| Free scan | $0 | 1 | 5 | 1 × 3 engines, once | 15 | $0.15–0.45 | — |
| Starter | **$49/mo** | 1 | 25 | 2 per engine, weekly | 600 | $6–18 | about 63–88% |
| Growth | **$149/mo** | 3 | 75 | 2 per engine, weekly | 1,800 | $18–54 | about 64–88% |
| Baseline (internal) | — | 20 public | 10 each | 1 per engine, weekly | about 2,400 total | $24–72 | cost of the moat |

\*Estimate based on about $0.01–0.03 per call (official prices, Oct 2026). Gemini Flash prices reportedly **double on 2027-01-01**. Review the pricing table in code (CS-9) before then. The answer cache (CS-10) should reduce real costs, because many customers in a niche ask the same questions.

Baseline cost control: refresh public categories **monthly** at launch and move to weekly only once paid revenue is above $500/mo.

## 8. Measurement method and honesty

- Each question is asked **twice per engine** on paid plans, and the report shows how often each brand appeared (e.g. "Jobber: 5/6 answers").
- Every report shows: *"Results come from each engine's official API with web search enabled. This approximates, but does not exactly match, what people see in the consumer apps. AI answers vary between runs."*
- Do not claim Google AI Mode coverage. Do not use statistics we can't source.
- **Location is pinned on every call.** Answers change with the asker's country (seen in the week-0 test), so each scan stores the target country and passes it to every engine: OpenAI's web-search user location, and an explicit country in the question for the other engines.
- Brand extraction uses an alias list per brand plus a cheap model. A wrong match is a bug, so show the matching answer text on hover.

## 9. Cost safety: non-negotiable invariants

A single abusive user, retry loop or leaked key must never produce a surprise bill. **Each invariant below needs an automated test or config check before release.** CI checks that every ID is present in this file.

| ID | Invariant |
|---|---|
| **CS-1** | **Prepaid credits with auto-recharge OFF** on OpenAI and Perplexity. Keep the balance at no more than 2 weeks of expected spend. If credits run out, calls fail; we never get billed more. |
| **CS-2** | **Gemini runs on a Google Cloud project with no billing account** (free tier only) **or** with a budget-triggered **automatic billing-disable** function, tested before any card is attached. Google Cloud budgets only alert by default; they do not cap spending. |
| **CS-3** | **No unlimited plans, and no user-controlled call counts.** Plans define questions × runs × engines. Extra usage requires a paid add-on. |
| **CS-4** | **Atomic credit reservation.** Before a scan starts, it reserves its full call budget in `credit_ledger` in one transaction. If the balance is too low, it is rejected. Unused calls are refunded on completion. Covered by concurrency tests. |
| **CS-5** | **Hard limits per scan:** at most 150 calls per scan; at most 1 running scan per account; at most 60 s per call; at most 2 retries with exponential backoff, and only on retryable errors. No retry loops anywhere. |
| **CS-6** | **Max output tokens set on every LLM call.** Answer calls are capped at 1,200 tokens, extraction and classification at 400, fix lists at 1,500. |
| **CS-7** | **Global circuit breakers** on `spend_daily`, checked before every engine call. At $10/day on free scans, pause free scans. At $30/day total, pause everything except in-flight paid scans (paid scans started before the trip). At $60 per calendar month above forecast (baseline spend this month ≥ baseline forecast + $60), pause baseline scans. Days and months are UTC. Each trip emails the owner. |
| **CS-8** | **Kill switch:** the `SCANS_ENABLED=false` environment flag stops all new engine calls within 60 s, with no deploy needed. |
| **CS-9** | **Every call's cost is logged** (tokens × a pricing table in code, plus search fees) to `engine_calls.cost_usd`. A daily spend email shows spend by engine, by account and the top 5 accounts by spend. |
| **CS-10** | **Answer cache:** identical (engine, model, normalized question, country, run number) results are reused for 72 h across accounts. Country is in the key because answers change by country (§8); the run number keeps a paid scan's two runs per engine two real answers. A cache hit costs $0 and still counts as history (M-1). |
| **CS-11** | **Free-scan abuse controls:** Turnstile; a verified email; 1 free scan per domain and per email per 30 days; disposable-email blocklist; max 3 free scans per IP per day; no free scans while the CS-7 free breaker is tripped. |
| **CS-12** | **Keys are server-side only.** No API key in client bundles or the repo; CI runs secret scanning on every pull request; keys are rotated on any suspected leak; each provider key is restricted to the minimum permissions/projects. |
| **CS-13** | **Spend alerts at 50% / 80% / 100%** of the monthly forecast, both in the providers' consoles and in our own daily email. |
| **CS-14** | **Load test before launch:** a scripted test of 100 simultaneous free-scan attempts and 10 paid scans against mocked engines must keep spend within the plan budgets and trip the breakers correctly. |

## 10. Legal and compliance

- **Official APIs only.** No scraping of AI apps, no logged-in automation, no getting around bot protection.
- **Enriching cited pages (M-2):** a polite, low-frequency fetch of *publicly cited* URLs only. Respect robots.txt, send an identifying user agent, and cache results. Limits: at most 1 request per domain every 10 s and a few in flight overall, a 10 s timeout, a 2 MB HTML-only body cap, one retry on 5xx only, no cookies or logins, and each page re-fetched at most once every 30 days. Enrichment only fills empty fields, so curator edits are never overwritten. Store **business** contact routes (contact pages, submission forms), never personal profiles or emails pulled from people's accounts.
- We sell **analysis and recommendations**, not personal-data lists.
- Paid placements we recommend must be **disclosed as sponsored** on the publisher's side (FTC Endorsement Guides). We never recommend fake reviews or astroturfing.
- A privacy policy and terms of service ship at launch, along with a data-deletion request flow and a GDPR-friendly data-processing summary.

## 11. Success metrics and kill criteria

| Metric | Target (8 weeks after launch) |
|---|---|
| Free scans from real FSM vendors | 100 or more |
| Free → paid conversion | 2–3% or more |
| Paying customers | 3 or more |
| Monthly logo churn (once 10+ paying) | 6% or less |
| API cost as a share of revenue | 25% or less |
| Public pages bringing free scans without outreach | At least 1 scan/week by week 12 |

**Kill or pivot:** if 100 targeted free scans produce fewer than 1 paying customer, improve the fix list (F-3) before adding any feature. If there's still no traction after a second cycle of 100, switch to the fallback niche.

## 12. Open questions

1. Which merchant of record accepts India-based sellers on the best terms today? (Week 0.)
2. Do the AI engines cite trade-specific listicles often enough for placements to be actionable? (Week 0 test, re-checked with real data in week 1.)
3. Exact current prices for each engine API. (Load the pricing table from the official pages in week 1; CS-9.)
4. Do mid-tier FSM vendors want comparison-page outlines (M-4), or ready-to-publish drafts (a possible v1.1 add-on)?
