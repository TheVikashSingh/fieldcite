// Citation page-type classification (SPEC F-2, M-2). Rules only, no API calls.

import type { Brand } from "./brands";

export type PageType = "listicle" | "review_site" | "forum" | "vendor_page" | "video" | "other";
export const PAGE_TYPES: readonly PageType[] = ["listicle", "review_site", "forum", "vendor_page", "video", "other"];

export interface ClassifiedCitation {
  url: string;
  title?: string;
  /** Registrable-ish domain without "www.", e.g. "g2.com". */
  domain: string;
  pageType: PageType;
  /** Brand that owns the page, for vendor pages. */
  owner?: string;
}

const VIDEO_DOMAINS = ["youtube.com", "youtu.be", "vimeo.com", "tiktok.com", "wistia.com"];
const FORUM_DOMAINS = ["reddit.com", "quora.com", "stackexchange.com", "contractortalk.com", "lawnsite.com", "pestcontrolforum.com"];
const REVIEW_DOMAINS = [
  "g2.com",
  "capterra.com",
  "capterra.co.uk",
  "capterra.ca",
  "capterra.com.au",
  "getapp.com",
  "getapp.co.uk",
  "softwareadvice.com",
  "trustradius.com",
  "trustpilot.com",
  "sourceforge.net",
  "softwareconnect.com",
  "selecthub.com",
  "featuredcustomers.com",
  "crozdesk.com",
];
const LISTICLE_PATTERN = /(\bbest\b|\btop[\s_-]?\d+|\btop\b|\balternatives?\b|\bvs\.?\b|\bversus\b|\bcompar(e|ed|ison)\b|\breview(s|ed)?\b)/i;
const GROUNDING_REDIRECT_HOST = "vertexaisearch.cloud.google.com";

const matchesDomain = (domain: string, list: string[]) => list.some((d) => domain === d || domain.endsWith(`.${d}`));

export function domainOf(url: string, title?: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = "";
  }
  // Gemini grounding links are Google redirects; the title carries the real source domain.
  if ((host === GROUNDING_REDIRECT_HOST || !host) && title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title.trim())) {
    host = title.trim().toLowerCase();
  }
  return host.replace(/^www\./, "");
}

function pathText(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname).replace(/[-_/]+/g, " ");
  } catch {
    return "";
  }
}

export function classifyCitation(citation: { url: string; title?: string }, brands: Brand[]): ClassifiedCitation {
  const { url, title } = citation;
  const domain = domainOf(url, title);
  const base = { url, title, domain };
  const path = pathText(url);

  if (matchesDomain(domain, VIDEO_DOMAINS)) return { ...base, pageType: "video" };
  if (
    matchesDomain(domain, FORUM_DOMAINS) ||
    /^(community|forum|forums|discuss)\./.test(domain) ||
    /\b(forum|forums|community|threads?|discussion)\b/i.test(path) ||
    /\/t\/[^/]+\/\d+/.test(url)
  ) {
    return { ...base, pageType: "forum" };
  }
  if (matchesDomain(domain, REVIEW_DOMAINS)) return { ...base, pageType: "review_site" };

  const owner = brands.find((b) => b.domain && matchesDomain(domain, [b.domain.toLowerCase().replace(/^www\./, "")]));
  // Vendor-owned "best X software" posts are still vendor pages: who owns the page decides the fix (SPEC F-3).
  if (owner) return { ...base, pageType: "vendor_page", owner: owner.name };

  if (LISTICLE_PATTERN.test(path) || (title && LISTICLE_PATTERN.test(title))) return { ...base, pageType: "listicle" };
  return { ...base, pageType: "other" };
}
