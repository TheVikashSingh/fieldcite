// Fix-list wording templates for field-service software vendors (SPEC M-4, F-3).
// Templates only give advice. The only facts in them are names the generator passes in from
// the evidence (page, competitors, page owners); every count comes from the "why" sentence the
// generator builds from stored answers.

import type { Country } from "../engines/types";

export type FixKind = "comparison_page" | "get_listed" | "review_profile" | "forum_answer" | "video_review" | "outreach" | "answer_page";

/** Tie-break order when two fixes have the same evidence strength. Week 0: own comparison pages first. */
export const FIX_KIND_ORDER: readonly FixKind[] = ["comparison_page", "get_listed", "review_profile", "forum_answer", "video_review", "outreach", "answer_page"];

export interface TemplateContext {
  target: string;
  /** e.g. "pest control". */
  trade: string;
  country: Country;
  /** Page title or domain, for page-based fixes. */
  page?: string;
  domain?: string;
  /** Competitors named in the evidence answers. */
  competitors?: string[];
  /** Brands that own the cited vendor pages, for comparison pages. */
  owners?: string[];
  question?: string;
}

export interface FixText {
  title: string;
  detail: string;
}

const COUNTRY_SHORT: Record<Country, string> = { US: "the US", UK: "the UK", CA: "Canada", AU: "Australia" };

/** What buyers in each trade compare tools on (M-4). Unknown trades get the generic field-service list. */
const TRADE_JOBS: Record<string, string> = {
  "pest control": "recurring service routes, chemical and treatment records, service agreements and invoicing",
  hvac: "dispatching, maintenance agreements, quoting with good-better-best options and invoicing",
  plumbing: "dispatching, on-site quoting, job costing and taking payment on the spot",
  cleaning: "recurring bookings, team scheduling, checklists and automatic billing",
  landscaping: "route planning, recurring visits, quoting and seasonal billing",
  "lawn care": "route planning, recurring visits, quoting and seasonal billing",
  "pool service": "recurring routes, chemical readings, service logs and automatic billing",
  electrical: "dispatching, quoting, job costing and compliance certificates",
};
const GENERIC_JOBS = "scheduling, dispatching, quoting, invoicing and payments";

export const tradeJobs = (trade: string) => TRADE_JOBS[trade.trim().toLowerCase()] ?? GENERIC_JOBS;

const list = (names: string[] = []) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export const FIX_TEMPLATES: Record<FixKind, (c: TemplateContext) => FixText> = {
  comparison_page: (c) => ({
    title: `Publish your own "best ${c.trade} software in ${COUNTRY_SHORT[c.country]}" comparison page`,
    detail:
      `${c.owners?.length ? `Competitors' own pages (${list(c.owners)}) are cited for these questions. ` : ""}` +
      `Publish an honest, dated comparison on your site that includes ${c.target} and the tools buyers ask about, ` +
      `with pricing, who each tool suits and how each handles ${tradeJobs(c.trade)}. Keep it updated, and link to it from your ${c.trade} pages.`,
  }),
  get_listed: (c) => ({
    title: `Get ${c.target} listed on ${c.page}`,
    detail:
      `Contact the publisher of this third-party list and ask for ${c.target} to be included or reviewed. ` +
      `Send a short pitch for ${c.trade} businesses in ${COUNTRY_SHORT[c.country]}: pricing, how you handle ${tradeJobs(c.trade)}, and a customer quote. ` +
      `Ask whether they take submissions, run an affiliate program or offer sponsored placement.`,
  }),
  review_profile: (c) => ({
    title: `Build ${c.target}'s reviews on ${c.domain}`,
    detail:
      `Claim or complete the ${c.target} profile on ${c.domain}, list it in the ${c.trade} software category, ` +
      `and ask recent ${c.trade} customers for honest reviews. Fill in pricing and the features buyers filter on (${tradeJobs(c.trade)}).`,
  }),
  forum_answer: (c) => ({
    title: `Answer in the discussion on ${c.page}`,
    detail:
      `Reply helpfully as a named member of the ${c.target} team, say who you work for, and follow the community's rules on self-promotion. ` +
      `Answer the actual question first, then explain where ${c.target} fits for ${c.trade} businesses.`,
  }),
  video_review: (c) => ({
    title: `Get a video review that includes ${c.target}`,
    detail:
      `Offer the creator behind ${c.page} a trial or a demo for a review or comparison video. ` +
      `Also consider publishing your own walkthrough of ${c.target} for a ${c.trade} business, showing ${tradeJobs(c.trade)}.`,
  }),
  outreach: (c) => ({
    title: `Ask ${c.domain} to mention ${c.target}`,
    detail:
      `Read the cited page, then contact the site owner with a short, specific suggestion for where ${c.target} belongs on it, ` +
      `and what makes it a fit for ${c.trade} businesses in ${COUNTRY_SHORT[c.country]}.`,
  }),
  answer_page: (c) => ({
    title: `Publish a page that answers "${c.question}"`,
    detail:
      `Write a clear, direct answer to this exact question on your site, mention ${c.target} by name, ` +
      `state that it serves ${c.trade} businesses in ${COUNTRY_SHORT[c.country]}, and cover ${tradeJobs(c.trade)} with real pricing.`,
  }),
};
