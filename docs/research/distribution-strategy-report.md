# Selling Distribution in the AI Era: Strategy Report

*Prepared 2026-10-18. Method: a multi-agent research run. Nine researchers worked in parallel: 5 ideation lenses, 1 thesis critic, and 3 fact-checkers covering competitors, platform/legal rules, and pricing/demand. A merge step produced 14 distinct candidates and dropped 23 ideas. For 7 candidates, two adversarial skeptics then tried to break each one: one on market and money, one on build, platform and legal risk. Your Claude Pro weekly limit stopped the run before the other 7 candidates were stress-tested. They are marked **UNVERIFIED** below.*

*Numbers marked "est." are reasoned estimates, not data. TrustMRR revenue figures are Stripe-verified but self-selected: founders choose to list them, so they skew toward winners.*

---

## TL;DR

1. **Your thesis is half right.** The diagnosis is correct: AI made code abundant and attention scarce. The prescription is wrong. Selling a $29/mo scanner to app developers means selling to the poorest, highest-churn buyers, in the most crowded micro-SaaS niche, on data that platforms are actively fencing off.
2. **Your three named ideas are dead or near-dead in late 2026.**
   - **Reddit** is closing public data access. New API requests stop Oct 31, 2026, RSS ends Nov 13, 2026, and public access ends March 2027. GummySearch (about 135K users) already shut down for lack of a commercial license.
   - **YouTube** policy bans selling or redistributing API data.
   - **Instagram's** API gives no access to comments on hashtag media.
3. **Verified money sits in outcomes, not tools.** Done-for-you distribution services earn **10-100x more per customer** than scanner tools. Examples: Reddit Agency makes $31.5K MRR from 6 clients, and AEO Engine $156K from 54. Most Reddit lead-finder SaaS shows under $1K MRR.
4. **Recommended bet: an AI-Answer Placement Desk.** Get B2B SaaS companies recommended by ChatGPT, Perplexity and Google AI answers, in one vertical, as a fixed-scope service. Your scanner runs internally on official paid APIs costing cents per call. This is "distribution in the AI era" in its most literal form. It has the strongest demand evidence of anything we tested and no platform kill-switch.
5. **Honest numbers for that bet:**
   - First dollar in 3-6 weeks; first recurring client in 6-10 weeks.
   - **Base case: about $2K/mo by month 6 and $3-4K/mo by month 12.**
   - Bull case: $8-10K by month 12. Bear case: under $500.
   - "High MRR in 90 days" isn't realistic without an existing audience. None of the 14 adversarial reviews found a path to it.

---

## 1. Verdict on your thesis

### Where you're right

- **App supply exploded.** Appfigures counted 557K new App Store submissions in 2025, up 24% and the first real rise since 2016 ([Appfigures](https://appfigures.com/resources/insights/20251205/2-the-app-store-just-logged-its-biggest-release-year-in-nearly-a-decade)). New subscription-app launches went from about 2,000/month (Jan 2022) to 14,700+/month (Jan 2026) ([RevenueCat](https://www.revenuecat.com/state-of-subscription-apps)).
- **Demand did not keep up.** App installs fell about 2.7% year over year while submissions rose. Median monthly revenue one year after launch is **about $72**. Only **17.3%** of new apps reach $1K/month within two years, and **4.6%** reach $10K ([RevenueCat](https://www.revenuecat.com/state-of-subscription-apps)).
- **Distribution is the bottleneck.** RevenueCat's own founders say so, and they expect "more competition, higher CACs, and higher churn."
- **Intent signals are valuable.** People publicly asking for a solution are the best raw material in distribution. Your instinct to sell to businesses is also right: ChartMogul's median monthly churn is about 6.1% for accounts under $25/mo versus about 2.2% for accounts over $500/mo ([ChartMogul](https://chartmogul.com/blog/good-customer-churn-rate/)).

### Where it breaks

1. **You'd be selling shovels to prospectors who mostly don't find gold.** In Lovable's own survey (n=14,300+), only **10.7%** of builders report revenue ([summary](https://redwerk.com/blog/vibe-coding-report/)). Someone earning $0 can't justify paying for leads, and they cancel when they abandon the project.
2. **The real shovels are owned by giants:** Nvidia, Anthropic, Cursor, Lovable, Supabase. A solo $29 scanner is one more stall in a crowded market.
3. **Your own logic cuts against you.** If AI makes apps cheap to build, it makes lead tools just as cheap. A September 2026 roundup lists 12 Reddit tools at $14-49/mo ([RedShip](https://redship.io/best-reddit-marketing-tools.md)), and F5Bot is free.
4. **A distribution tool needs distribution itself.** $10K MRR at $29/mo is about 345 customers. At about 6% monthly churn you'd need about 21 new paying customers *every month* just to stay flat.
5. **The data is being fenced off.** Reddit, LinkedIn (the Proxycurl injunction), YouTube (no redistribution) and X (pay-per-read) are all locking or monetizing their data. See section 2.
6. **Leads are not distribution.** A list of threads doesn't fix bad positioning or a weak reply. Customers blame the leads and churn. The value sits downstream, in the reply, the placement, the meeting.
7. **Shared leads go stale.** When ten tools send the same thread to ten vendors, it fills with pitches. Exclusivity and speed are what buyers pay for.
8. **You have no distribution either.** The fastest-growing indie tools on TrustMRR mostly had founders with large audiences (Gojiberry, TrustMRR, POST BRIDGE). Without one, your channel is personalized outbound, and that outbound is the skill you're really selling.

### Reframed thesis
>
> **Code is abundant; trusted attention is scarce. Don't sell shovels to broke prospectors. Sell *delivered gold* to businesses that are already mining profitably: placements, citations, qualified conversations and meetings. Use AI-built tools as your private leverage, not as the product, until 10 clients pay for the same workflow. Then productize it.**

Two AI-era twists the original thesis missed:

- **AI answer engines are now a distribution channel.** "Who does ChatGPT recommend for X?" is the new shelf space. Few small vendors know how to get onto it.
- **Platforms are taking the raw data for themselves.** For example, Reddit now licenses its data for revenue. A tiny player's lasting value is **judgment and workflow on top of open or customer-authorized data**, not owning or reselling the data.

---

## 2. Facts that change the plan (verified)

### Platform access, late 2026

| Source | Status | Usable? |
|---|---|---|
| **Reddit** | Self-serve API keys ended Nov 11, 2025. Unauthenticated `.json` returns 403 since May 2026. **New API requests stop Oct 31, 2026, RSS ends Nov 13, 2026, and public access ends March 2027.** Reddit is suing scrapers: DMCA §1201 claims against SerpApi and Perplexity survived dismissal in July 2026. ([TechRepublic](https://www.techrepublic.com/article/news-reddit-rss-public-api-shutdown/), [Decrypt](https://decrypt.co/379892/reddit-killing-rss-feeds-public-api-access-ai-scrapers), [ppc.land](https://ppc.land/reddit-to-halt-public-data-api-access-in-march-2027-as-14-000-apps-register/), [Search Engine Land](https://searchengineland.com/reddit-sues-perplexity-serpapi-scraping-google-463681)) | **No** |
| **GummySearch** (precedent) | About $35K MRR and 135K+ users. Shut down because it couldn't get a commercial Reddit license; sales ended Nov 30, 2025 ([GummySearch](https://gummysearch.com/final-chapter)) | — |
| **Instagram** | 30 unique hashtags per 7 days, no comments on hashtag media, App Review required | **No** |
| **LinkedIn** | Proxycurl (about $10M revenue) shut down under a permanent injunction in July 2025 | **No** |
| **YouTube Data API** | 10K units/day free, but policy forbids selling or redistributing data and caps storage at 30 days | Internal use only |
| **X API** | Legal pay-per-use, about $0.005 per post read | Yes, but you pay per read; can run on the customer's key |
| **Hacker News** (Firebase and Algolia) | Free, no key, tested working | Yes, but volume is thin (below) |
| **Bluesky Jetstream** | Open firehose, tested working; anonymous search returns 403. Usage down about 52% from peak (Similarweb via TechCrunch) | Yes, shrinking |
| **Apple App Store review RSS** | Works, version-tagged ratings | Yes |
| **GitHub API** | 5K requests/hr. The Acceptable Use Policy bans using its data for unsolicited email or selling personal info | Repo and issue signals only |
| **LLM answer APIs** | OpenAI web search $10 per 1K calls. Perplexity Sonar $5-14 per 1K requests plus tokens. Gemini grounding: 5K free searches/month, then $14 per 1K. Google AI Mode only through third parties such as DataForSEO | **Yes, legitimate and cheap** |
| **Government open data** | FMCSA, SEC EDGAR Form D, SAM.gov, Companies House | Yes |

### Where verified money actually is

| Business (TrustMRR unless noted) | MRR | Customers | Revenue per customer | Model |
|---|---|---|---|---|
| AEO Engine (since 2018) | $156K | 54 | about $2.9K | AEO agency |
| Rank Prompt (founded May 2025, founder had **38 X followers**) | $43.4K | 210 | about $207 | AEO tool + agency tiers ($150-2,000/mo) |
| Launch Club (since 2022, about 6K followers) | $33.75K | 16 | about $2.1K | Reddit + AI-search service |
| Reddit Agency (founded Feb 2025) | $31.5K | 6 | about $5.25K | Done-for-you, with a guarantee |
| unfair.so (founded Jul 2026) | $30.6K | 38 | about $800 | X conversation → lead → outreach |
| Veail (local trades leads) | $22.6K | 21 | about $1.08K | Exclusive local leads |
| Leadverse (self-reported, [Indie Hackers](https://www.indiehackers.com/post/launching-countless-apps-until-one-gained-momentum-and-hit-3-3-k-mrr-U9btJ44RYRcAaukCqHoj)) | $3.3K | 130+ | about $25 | Reddit lead-finder SaaS |
| Stalkr (Marc Lou, **380K+ followers**) | $290 | 10 | $29 | Social listening SaaS |

**The pattern:** tools in this space earn $25-200 per customer, and services earn $1,000-5,000. Even a famous founder couldn't make a generic listening tool work (Stalkr). A founder with 38 followers built a $43K MRR AEO business in about 17 months (Rank Prompt). Treat it as an outlier, not a plan.

### Volume reality check on "free" intent sources

The skeptics measured this live on 2026-10-17. Across **all of Hacker News in 30 days**, about 22 Ask HN titles looked like intent ("recommend", "looking for", "alternative"), and only **about 5 were real product requests**. Bluesky returned about 14 "looking for a tool" posts a month across *every* topic.

Without Reddit and LinkedIn, an open-data "buyer-intent digest" is too thin for most niches. The exception is devtools, where X, HN, GitHub and Stack Overflow overlap. This finding sank several candidates.

### Base rates to plan around

- About 81% of 970 Stripe-verified Indie Hackers products make under $500 MRR, about 6.4% over $5K, and about 4.8% over $10K ([IH](https://www.indiehackers.com/post/how-much-money-do-indie-hackers-products-make-74db9631f0); self-selected sample).
- TrustMRR, 5,079 startups: **median about $169/mo**, top quartile above about $800 ([IH](https://www.indiehackers.com/post/i-analyzed-5-079-stripe-verified-startups-f0f6bd053f)).
- Realistic solo SaaS ramp: LeadShark took **29 months** to reach $19.7K MRR at about $51 per subscriber.
- No reliable public data exists on how fast solo *services* ramp. The service timelines below are reasoned estimates.

---

## 3. Scoreboard: all 14 candidates

Scores are out of 10, as Market/money skeptic / Build-risk skeptic. MRR figures are the skeptics' **central** estimates (est.).

| # | Idea | Model | Who pays | Price | Scores | M3 / M6 / M12 | Fatal-ish risk | Verdict |
|---|---|---|---|---|---|---|---|---|
| **1** | **AI-Answer Citation Gap + Placement Desk** | Service → SaaS | B2B SaaS at $20K-200K MRR in one vertical | Free snapshot → $149-499 report → **$1.5-3K 90-day sprint** → optional retainer | **5 / 5.5** | $500-750 / $1.8-2K / $3-4K | ROI is hard to attribute (AI traffic is about 3% of organic); free diagnostics from HubSpot and Reditus | **Viable, best fit** |
| 2 | Trigger-to-Pipeline Desk (implementation partners) | Hybrid | Salesforce/NetSuite partners, data/AI consultancies | $300-750/mo brief; $1-1.5K/mo + $150-300 per held meeting | 4 / 6 | $300-900 / $2K / $3.5-5K | Sumble $99, TheirStack, Clay, HubSpot's native prospecting agent; 60-90 day attribution lag | Viable for a sales-minded person |
| 3 | AI App Store Porting (ChatGPT/Claude plugins, MCP) | Project + care plan | API SaaS at $20K+ MRR; Custom GPT creators with Actions | $299 audit; $1.5-5K build; $199-499/mo care | 4 / 5.5 | $0-500 / $400-1.5K / $1-4K | No proven listing ROI (Bloomberg: "sluggish adoption"); builds becoming free (Stainless, Gram, OpenAI's own migration) | Cash bridge, not a business |
| 4 | Founder-Voice Intent Desk | Hybrid | Devtools/B2B SaaS at $5K-100K MRR | $150 pilot → $400-900/mo | 4 / 5 | $400-800 / $1.2-2K / $2-4K | Open data too thin without Reddit; Octolens covers more at $159 | Only if narrowed to devtools with X as the core source |
| 5 | Fresh-Entity Feeds (new US trucking carriers) | Data | Truck insurance agents, freight factoring firms | $99-299/state | 4 / 4 | $150-300 / $300-1.5K / $1.2-3K | Commodity data ($4-20 per 1K on Apify; $39-49/mo subscriptions); new grants already have insurance | Weak, unless you sell *timing* (pending authorities) |
| 6 | Competitor Exodus Radar | SaaS | Challenger SaaS | $149/mo per competitor | 3 / 4 | about $150 / about $450 / $0.5-4K | The same product on Apify has 2 users; value arrives in bursts, so subscribers churn | Weak |
| 7 | Shopify App Switch Leads | SaaS | Shopify app companies | $99-399/mo | 3 / 4 | $0-150 / $100-450 / $0.3-1.2K | **Buyers can't act on it:** the Partner Program Agreement bans emailing merchants; Klaviyo gets about 4 one-star reviews a month | Kill (pivot to competitive intelligence at most) |
| 8 | Be-the-List vertical comparison site + newsletter | Media | Vertical SaaS vendors (affiliate, featured listings, sponsorships) | $149-399 review; $99-299/mo featured | UNVERIFIED | Slow: 6-12+ months to meaningful revenue (est.) | Will AI engines cite a new site? | Good *second* asset (see section 5) |
| 9 | Digital-Services RFP & Tender Radar | SaaS | Web, dev and marketing agencies | $49-149/mo + $99-299 per proposal draft | UNVERIFIED | — | GovTribe and BidPrime incumbents; fragmented local portals | Worth a later check |
| 10 | Short-Form Distribution Desk (clipping + AI UGC ads) | Service | B2C subscription apps at $5K+ MRR | $750-2.5K/mo | UNVERIFIED | — | Must prove CAC in 1-2 months; UGC prices compressing | Plausible, needs creative skill |
| 11 | Conversion-Tracked Sponsorship Desk | Brokerage | Devtools/B2B SaaS | $750-1.5K/mo + 10-15% of media | UNVERIFIED | — | Clients book direct once they learn which newsletters work | Medium |
| 12 | Sunset Auction (endorsed migration when software dies) | Brokerage | Competitors of the dying product | 10-20% success fee | UNVERIFIED | Lumpy | Rare events; GDPR limits on endorsements | Opportunistic only |
| 13 | Community Intent Exchange (Discord/Slack bot with labeled sponsors) | Marketplace | App devs pay per intent; community owners get a revenue share | $2-20 per intent | UNVERIFIED | — | Two-sided cold start; Discord message-content access is privileged | Too slow for you |
| 14 | Uplift Distribution Label (revenue share on new MRR) | Publisher | Indie SaaS at $200-3K MRR | 25-35% of net new MRR | UNVERIFIED | — | Needs a *proven* playbook first; attribution disputes | Phase 3 at the earliest |

---

## 4. The recommendation: AI-Answer Placement Desk

### Why this one

- **It is your thesis, upgraded.** It sells distribution in the channel AI itself created. "ChatGPT recommends your competitor, not you" lands far harder than "here are some Reddit threads."
- **It has the strongest demand evidence we found.** AEO Engine makes $156K MRR, Rank Prompt $43K (from near-zero audience, founded May 2025), and Reddit Agency $31.5K. Agency retainers run $1,597-10,000/mo.
- **There's no platform kill-switch.** You use official, pay-as-you-go APIs (OpenAI, Perplexity, Gemini), not scraped data.
- **It's cheap to run.** One query costs about $0.007-0.03, and a full client scan of 600 calls costs about $5-15. Monthly running costs are about $40-150 (est.).
- **Both skeptics rated it "viable."** It was one of only two candidates to get that from both.

### What the skeptics forced us to change

- **Don't sell "AI visibility" monitoring.** That is commoditized: HubSpot's grader and the Reditus citation finder are free, Otterly starts at $29, and VC-funded Profound and Peec serve 3,500+ brands. **Sell deliverables you control**: pages shipped, placements secured, before/after share of voice.
- **Don't sell to $5K MRR startups.** A $1.5K retainer would be 30% of their revenue. Target **$20K-200K MRR** or recently funded companies.
- **Don't promise results you can't control.** Answers vary heavily between runs (less than a 1-in-100 chance of the same brand list twice, per SparkToro). Promise *work and measurement*, not "ChatGPT will recommend you."
- **Avoid claims you can't back.** The "30 domains take 67% of citations" stat circulating online is unverified, so don't use it. Don't claim Google AI Mode coverage unless you actually pull it (via DataForSEO).
- **Pick ONE vertical.** One citation map of the 20-40 pages AI engines cite for that category can be reused for every prospect in it. That cuts your delivery time and makes you the expert.

### The offer

1. **Free hook: a 5-prompt snapshot** (one image). For example: "For *'best scheduling tool for clinics'*, ChatGPT and Perplexity recommend A, B and C. You're absent. These are the 6 pages they cite."
2. **Citation Gap Report, $199-499** (credited to the sprint). Covers 30-50 buyer prompts × 3 engines × 3 runs: share of voice, every cited URL classified (listicle, comparison, review site, forum, YouTube), which cited pages accept submissions, sponsorships or affiliates, and a prioritized fix list.
3. **90-Day Placement Sprint, $1,500-3,000, prepaid, fixed scope.** Includes:
   - comparison and "alternatives" pages written for the client's site
   - homepage and positioning clarity fixes
   - about 40 cited-page owners pitched
   - an affiliate program set up (Rewardful or Reditus)
   - review-profile cleanup
   - a before/after share-of-voice re-scan
4. **Optional monthly retainer, $500-1,000**, or a per-placement fee of $250-500 per secured live mention on an already-cited page.
5. **Later: a self-serve tracker** for the vertical at $99-299/mo, once 10 clients prove the workflow. That's Rank Prompt's model.

### What to build with Claude Code (1-2 weeks, about 15-30 hours)

- A Python scanner calling OpenAI Responses with web search (on a mini/nano model), Perplexity Sonar (low context), and Gemini Flash-Lite grounding (inside the free 5K/month).
- Citation parsing and deduplication. Page-type classification with a nano-class model. Affiliate-link detection.
- Output to Google Sheets plus a one-page PNG/PDF snapshot. No UI, no SaaS yet.
- **Important:** production runs must use cheap API models, not your Claude Pro subscription. This research hit your weekly limit twice. Use Claude Pro to *write the code*, not to *run the business*.
- Start with about $50 of API credit. The first $299 report pays it back.

### Getting the first 10 customers

1. **Week 1-2:** Choose the vertical. Criteria:
   - a crowded B2B SaaS category with 30+ vendors
   - buyers who ask AI "best X for Y" questions
   - a #1 vendor that dominates answers while #5-20 are missing
   - affiliate programs common in the category

   Example categories: clinic or salon scheduling, AI note-takers, HR or payroll for SMBs, a devtools niche. Then run the full citation map for the category.
2. **Week 2:** Build a list of 120-200 vendors from G2/Capterra category pages and TrustMRR listings, filtered to signs of $20K+ MRR (team size, funding, pricing tiers). Note who is missing from AI answers.
3. **Weeks 3-6:** Send 15-25 hand-personalized messages a day by email, LinkedIn or X, each with that vendor's free snapshot. **Publish the vertical's citation map publicly** as a lead magnet ("Who ChatGPT recommends for X, and why"). That is your own distribution.
4. **Close the report, then the sprint.** Ask every client for a before/after case study you can publish.

### Kill and pivot criteria

- **150 personalized pitches with free snapshots → fewer than 2 paid reports by week 6:** change the vertical or the offer, not the tech stack.
- **3 sprints delivered with no measurable share-of-voice lift:** reposition around the deliverables (pages, placements) or switch to runner-up #2.
- **10+ clients buying the same deliverable:** productize it.

---

## 5. Runner-ups and how they combine

- **Bridge option (time-boxed): Custom GPT → ChatGPT plugin migrations.** OpenAI is retiring Custom GPTs on **Dec 11, 2026**, and Custom Actions may need rebuilding (Enterprise deferral reported to Feb 11, 2027). That's a real deadline wave. A few $300-1,500 migrations could fund the first months. Weak as a business; only good as a bridge. Don't build demo plugins on other companies' APIs without permission: that raises trademark and API terms problems, and OpenAI checks listing identity.
- **Switch to the Trigger-to-Pipeline Desk if** you enjoy B2B outbound and want buyers whose deals are worth $10K-200K. Pick an ecosystem HubSpot's native agent doesn't cover, such as Salesforce or NetSuite partners, or data/AI consultancies. Lead with a *backtest*: "here are 5 companies my system would have flagged 6 months ago that later became your clients." Then charge base plus per-meeting.
- **Switch to the Founder-Voice Intent Desk only if** you know devtools well. Narrow it to devtools and make X (official API, priced into your fee) plus GitHub competitor-repo issues ("migrating from X", "alternative to X") the core sources. unfair.so's $30.6K MRR shows buying conversations on X do sell. Run the volume test first: 10+ real intent threads per product per week, or don't sell it.
- **Compounding asset for month 3+: Be-the-List** (UNVERIFIED). An independent, AI-citable "best tools for [persona]" site and newsletter *in the same vertical* as your AEO work. Over time you become one of the pages AI engines cite. Anything paid on it **must be labeled sponsored**; see section 8.

---

## 6. 90-day plan

| When | Do | Measure |
|---|---|---|
| **Week 1** | Pick the vertical. Build the scanner MVP with Claude Code. Spend about $30-50 of API credit on the category citation map (30 prompts × 3 engines × 3 runs). | Scanner runs end-to-end; citation map done |
| **Week 2** | Build a 150-200 vendor list. Draft the snapshot template, the $299 report template and the sprint scope doc. Post the category citation map publicly on X and LinkedIn. | List built; first public post |
| **Week 3** | Outreach: 15-25 personalized snapshot messages a day. Book calls. Publish one insight post a week. | Reply rate, calls booked |
| **Week 4** | Close the first paid report or pilot. Deliver it in 48 hours. Ask for a testimonial. | First $ (target: by week 4-6) |
| **Month 2** | Convert 1-3 report buyers to the 90-day sprint. Templatize delivery (pages, pitch emails, affiliate setup). Re-scan monthly. | Sprints sold; hours per client |
| **Month 3** | **Decision point.** Continue if 3+ paying clients and visible share-of-voice lift; otherwise pivot (section 4 criteria). Publish the first case study with real numbers. | MRR equivalent; lift per client |
| **Months 4-6** | Add a $99-299/mo self-serve tracker for the vertical, plus white-label reports for small SEO agencies. Consider a VA for pitching page owners. | Self-serve signups; agency deals |

On "MRR": prepaid 90-day sprints are project revenue. A $2,000 sprint is about $667/month equivalent. Real MRR comes from retainers and the later tracker.

---

## 7. How quick and how much: the honest answer

Across all 14 adversarial reviews, no candidate showed a credible path to high MRR in 90 days for a founder with no audience and no budget. The realistic trajectory for the recommended bet:

| Scenario | Probability (est., my judgment) | Month 3 | Month 6 | Month 12 | What it looks like |
|---|---|---|---|---|---|
| **Bear** | about 50% | $0-300 | $0-500 | under $1K or pivoted | Can't land 2 clients from 150 pitches, or clients churn because lift isn't measurable. This is the most common micro-business outcome (median TrustMRR startup: about $169/mo). |
| **Base** | about 35% | $500-1,000 | $1.5-3K | $3-5K | 3-6 clients on sprints or retainers. Labor-capped around 10-12 clients (about $5-9K) until productized. |
| **Bull** | about 15% | $1.5-2.5K | $4-6K | $8-10K+ | Strong vertical, public citation maps generate inbound, and the self-serve tracker takes off. Rank Prompt ($43K MRR in about 17 months, 38 followers at start) is the top-percentile version. |

**Where "quick" stops:**

- **Fastest:** first dollar in 3-6 weeks.
- **Middle:** $1-3K/mo in about 2-4 months.
- **Slow:** $5-10K/mo takes 6-12 months for the disciplined minority. Getting there needs productization or a higher-ticket buyer, not more hours.

**Why services first:** $10K MRR is about 345 customers at $29, or about 7 at $1,500. Services get to $1-3K fastest; software scales once you know exactly what to sell.

---

## 8. Ideas to avoid, and why

**Your original ideas:**

- **Reddit scanner SaaS.** Data access closes by March 2027, GummySearch died for exactly this reason, and scraping Reddit now carries litigation risk.
- **YouTube comments scanner as a product.** YouTube policy forbids selling or redistributing API data and caps storage at 30 days.
- **Instagram scanner.** 30 hashtags per 7 days, no comments on hashtag media, App Review required.
- **Selling "lists of people" (usernames or contacts tagged with intent).** It triggers GDPR Art. 14 notice duties for every EU person, CCPA thresholds and data-broker registration (about $6K/yr in California), and several platforms' terms. It's also priced as a commodity (RB2B identifies visitors at about $0.25-0.45 each).

**Other popular traps** (from the 23 dropped ideas):

- **LinkedIn scraping or signal tools.** Proxycurl's injunction.
- **GitHub stargazer or developer contact lists.** GitHub's Acceptable Use Policy.
- **Google Maps local-business lead lists.** Google Maps Platform terms forbid building mailing or telemarketing lists.
- **AI auto-reply or auto-posting bots, and aged or purchased accounts.** Bans, Reddit Rule 8 (tightened May 2026), YouTube III.I.2.
- **Product Hunt upvote or launch-pact tools.** Vote manipulation is banned; LaunchPact makes $440 MRR.
- **Launch and directory-submission services.** Commodity one-time fees of $25-999; Uneed alone sees about 850 launches a month.
- **Generic LLM-visibility tracker SaaS.** VC-funded incumbents, with new $0 entrants weekly.
- **Website visitor identification.** Needs identity-graph data deals; RB2B and Snitcher already sell it at $49-199.
- **Cross-promotion networks between indie apps, reverse marketplaces, and idea databases.** Two-sided cold start, broke buyers.
- **Agentic-commerce plays.** OpenAI scaled back ChatGPT Instant Checkout in Mar 2026 after only about 12-30 merchants went live.
- **The Trigify-refugee wedge** (shuts down Oct 22, 2026). Its users need LinkedIn signals you can't legally supply, and 9+ funded alternatives are already courting them.

---

## 9. Legal and platform red lines

1. **No scraping behind logins, and no getting around bot protection, CAPTCHAs or rate limits.** DMCA §1201 claims survived against SerpApi and Perplexity (July 2026). Stay with official APIs and open protocols.
2. **No auto-posting, auto-DMs, or purchased or aged accounts** on any platform. Draft, then a human approves and posts from their own account.
3. **Don't sell personal-data lists.** Sell links to public conversations, analysis and outcomes. Keep retention short, build no dossiers on people, and honor deletion requests.
4. **Disclose paid placements.** If a "placement" involves payment, free product or affiliate money, the FTC Endorsement Guides require clear disclosure, and the FTC's 2024 rule bans fake reviews. Undisclosed astroturfing ("seeding" recommendations from fake users) is off the table; it's also how some Reddit-marketing agencies get clients banned.
5. **Respect API terms on redistribution:** YouTube (no resale, 30-day storage), X (developer agreement limits), and vendor-data resale terms (for example TheirStack's separate data-reselling terms).
6. **Cold outreach:**
   - US: CAN-SPAM rules (opt-out, physical address).
   - EU/UK: stricter rules (GDPR/PECR); keep it personalized, relevant and low-volume.
   - India: if you operate from there, the DPDP Act's substantive duties reportedly start May 13, 2027. Verify before relying on it.

---

## 10. Caveats and what was not verified

- Candidates 8-14 were **not** adversarially verified; the Claude Pro weekly limit was hit. Their descriptions come from the ideation and merge stage only.
- Several research agents ran out of search budget. A few items rest on vendor pages or training knowledge and are flagged in the raw data: Bluesky commercial terms, exact DPDP Rules text, X redistribution limits, current Google Maps terms.
- TrustMRR is self-selected and some listings are stale or anomalous (for example Pastel). Use it for direction, not precision.
- Probabilities in section 7 are judgment, not statistics.
- Before you spend money, check every platform's *current* terms yourself. They changed repeatedly during 2025-26.

---

## Key sources

- Reddit shutdown timeline: [TechRepublic](https://www.techrepublic.com/article/news-reddit-rss-public-api-shutdown/) · [Decrypt](https://decrypt.co/379892/reddit-killing-rss-feeds-public-api-access-ai-scrapers) · [ppc.land](https://ppc.land/reddit-to-halt-public-data-api-access-in-march-2027-as-14-000-apps-register/)
- GummySearch shutdown: [gummysearch.com/final-chapter](https://gummysearch.com/final-chapter)
- App economy base rates: [RevenueCat State of Subscription Apps](https://www.revenuecat.com/state-of-subscription-apps) · [Appfigures](https://appfigures.com/resources/insights/20251205/2-the-app-store-just-logged-its-biggest-release-year-in-nearly-a-decade)
- Verified service and tool revenue: [AEO Engine](https://trustmrr.com/startup/aeo-engine) · [Rank Prompt](https://trustmrr.com/startup/rank-prompt) · [Reddit Agency](https://trustmrr.com/startup/reddit-agency) · [Launch Club](https://trustmrr.com/startup/launch-club) · [unfair.so](https://trustmrr.com/startup/unfair) · [LeadShark](https://trustmrr.com/startup/leadshark)
- Churn by price: [ChartMogul](https://chartmogul.com/blog/good-customer-churn-rate/)
- LLM API pricing: [Perplexity](https://docs.perplexity.ai/getting-started/pricing) · [OpenAI](https://developers.openai.com/api/docs/pricing)
- Competitor tools: [Octolens](https://octolens.com/pricing) · [Otterly](https://otterly.ai/pricing) · [HubSpot AI Search Grader](https://www.hubspot.com/ai-search-grader) · [Apify pricing](https://apify.com/pricing)
- Scraping litigation: [Search Engine Land](https://searchengineland.com/reddit-sues-perplexity-serpapi-scraping-google-463681)
- GDPR Art. 14: [gdpr-info.eu](https://gdpr-info.eu/art-14-gdpr/)
