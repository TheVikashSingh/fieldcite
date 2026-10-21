# Week 0: Vertical test results

*Run 2026-10-21 in the built-in browser, logged out, from an India IP. Covers ChatGPT (search on) for 5 questions and Perplexity for 1 question, since Perplexity allows only one logged-out query.*

## Raw results

| # | Question | Engine | Brands recommended (in order) | Cited sources |
|---|---|---|---|---|
| 1 | best scheduling and invoicing software for a small HVAC company | Perplexity | Jobber, Housecall Pro, Joist, Service Fusion, ServiceTitan (FieldEdge in text) | g2.com/articles/best-hvac-software · joist.com (HVAC invoicing guide) · servicetitan.com ×2 blog · capterra.com (HVAC estimating, small business) · getjobber.com/academy (best HVAC CRM) · fieldedge.com · myquoteiq.com (best HVAC scheduling 2026) · housecallpro.com (best HVAC software) · smith.ai blog |
| 1 | same | ChatGPT | Jobber, Housecall Pro, Service Fusion, FieldEdge, ServiceTitan | Vendor pages (Jobber, Housecall Pro, FieldEdge, ServiceTitan) |
| 2 | Jobber alternatives for a 3-person cleaning business | ChatGPT | ZenMaid, Maidily, BookingKoala, Housecall Pro, Zenbooker | get.zenmaid.com · **SmallCrew HQ** (cited 3×) · G2 · vendor sites |
| 3 | best field service software for pest control UK | ChatGPT | ServiceM8, Commusoft, Klipboard, Joblogic, HiveSuite | Vendor pages · **Software for Tradespeople** (review site) |
| 4 | cheapest quoting app for a solo landscaper | ChatGPT | LawnPro, Yardbook, Joist, CappsAI Studio (India-only, an artifact of the India IP) | **GreenMargins** · **"Reserchers"** · Compare Joist · vendor sites |
| 5 | Housecall Pro vs Jobber for plumbers | ChatGPT | Housecall Pro, Jobber | Vendor feature and pricing pages |

## Findings

1. **Vendor-owned "best X software" pages get cited heavily.** For question 1, 7 of Perplexity's 10 sources were vendors' own blog or academy posts. A mid-tier vendor can **publish its own** trade × country comparison pages and get cited. This is the single strongest fix-list item (SPEC F-3, M-4).
2. **Small third-party review sites carry real weight:** SmallCrew HQ, GreenMargins and Software for Tradespeople. They are winnable placements for the action database (M-2).
3. **Long-tail questions bring different vendor sets.** Jobber and Housecall Pro dominate generic questions. Trade-specific and country-specific questions (cleaning, pest control UK, landscaping) surface ZenMaid, ServiceM8, Commusoft, Klipboard, LawnPro and others. That fits "mid-tier vendors fighting for long-tail answers."
4. **18 distinct vendors appeared in just 6 answers**, so the prospect pool looks deep. Notable absences worth checking as prospects: Workiz, GorillaDesk, FieldRoutes/PestPac, Tradify, Fergus, Kickserv.
5. **Location changes answers.** ChatGPT saw the India IP and suggested an India-only app. **Product requirement:** every engine call must set the buyer's country. For example, OpenAI web search supports a user-location parameter; for the other engines, put the country explicitly in the question. Add this to SPEC §8.
6. Perplexity's logged-out limit (1 query) doesn't affect the product, which uses the Sonar API.

## Score (0–2 each)

| Criterion | Score | Why |
|---|---|---|
| Answer concentration (a leader, with mid-tier vendors missing) | 2 | Jobber and Housecall Pro dominate generic questions; many real vendors are absent |
| Cited pages are winnable | 2 | Vendor blogs and small review sites, not only G2/Forbes |
| Prospect density (30+ vendors) | 2 | 18 vendors in 6 answers, plus known absentees (provisional until the Capterra count) |
| Value per customer (at least $1K/yr) | 1 | Plans seen run $10–269/mo; many are $30–150/mo, about $350–1,800/yr per account |
| Reachability | 1 | Not tested yet (founders and marketers on LinkedIn/X) |
| **Total** | **8 / 10** | **Above the 6 threshold. Proceed with field-service software (FSM).** |

## Payment provider (merchant of record) shortlist

Based on secondary sources, several of them written by Dodo Payments itself, so they're biased. **Verify on each official site before applying.**

| Provider | Fees (as reported) | India notes |
|---|---|---|
| **Paddle** | 5% + 50¢ | Established; reportedly supports UPI and UPI Autopay for Indian buyers. Check sole-proprietor eligibility. |
| **Dodo Payments** | about 4% + 40¢ base, plus international and subscription surcharges | India-founded; payouts in USD, INR and USDC reported. |
| **Polar** | Payouts 0.25% + 25¢ plus $2/mo | Developer-focused; check India payout support. |
| **Lemon Squeezy** | 5% + 50¢; 1% on non-US payouts | Now owned by Stripe and moving merchants to Stripe Managed Payments. Past reports of slow onboarding for Indian sellers that aren't companies. |

**Suggestion:** apply to **Paddle and Dodo Payments** in parallel (you have to create the accounts yourself) and go with whichever approves you first.

Sources: [Paddle vs Lemon Squeezy](https://dodopayments.com/blogs/paddle-vs-lemon-squeezy/) · [Cheapest MoR](https://dodopayments.com/blogs/cheapest-merchant-of-record) · [India payment gateways](https://learnwithhasan.com/payment-gateways/country/india/) · [Lemon Squeezy alternatives](https://affonso.io/blog/lemon-squeezy-alternatives-for-saas) · [SaaS payment fees](https://refgrow.com/tools/saas-payment-fees)

## Still to do in Week 0 (yours, since they need accounts)

- [ ] Count 40 mid-tier FSM vendors from Capterra/G2 categories (I can do this in the browser next session).
- [ ] Apply to Paddle and Dodo Payments.
- [ ] OpenAI and Perplexity API accounts with prepaid credits and **auto-recharge OFF** (CS-1); Gemini project with **no billing** (CS-2).
- [ ] Supabase, Vercel, Resend, Turnstile accounts; buy a domain.
