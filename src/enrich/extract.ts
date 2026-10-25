// Reads a fetched cited page and finds the action-database facts (SPEC M-2): publisher,
// business contact page, submission page, affiliate signals, sponsorship page and known brands.
// Rules only, no API calls. Only business routes are kept, never personal emails or profiles
// (SPEC §10): mailto/tel links, social profiles and author/people pages are ignored, stored URLs
// drop their query and fragment, and any value that looks like an email is thrown away.

import { extractBrandsByAlias, type Brand } from "../extract/brands";

export interface PageFacts {
  publisher: string;
  contactUrl?: string;
  submissionUrl?: string;
  sponsorshipUrl?: string;
  /** true when an affiliate or partner program is mentioned; undefined when no signal was seen. */
  affiliateProgram?: true;
  /** The text or link that set affiliateProgram, for the curator. */
  affiliateEvidence?: string;
  brandsMentioned: string[];
}

interface Link {
  url: URL;
  text: string;
  rel: string;
}

const EMAIL = /[^\s@/:]+@[^\s@/]+\.[a-z]{2,}/i;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/<>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  // Skip the tag name.
  const inner = tag.replace(/^<\s*[a-z0-9-]+/i, "").replace(/\/?>$/, "");
  for (const m of inner.matchAll(re)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

const withoutComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, " ");

/** The page's visible-ish text: no scripts, styles or tags. */
export function visibleText(html: string): string {
  return clean(
    withoutComments(html)
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function metaContent(html: string, names: string[]): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const key = (a.property ?? a.name ?? "").toLowerCase();
    if (names.includes(key) && a.content?.trim()) return clean(a.content);
  }
  return undefined;
}

const ORG_TYPES = new Set(["organization", "corporation", "newsmediaorganization", "onlinebusiness", "localbusiness", "educationalorganization"]);

function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      nodes.push(o);
      if (o["@graph"]) visit(o["@graph"]);
    }
  };
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/application\/ld\+json/i.test(attrs(`<script ${m[1]}>`).type ?? "")) continue;
    try {
      visit(JSON.parse(m[2]));
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  }
  return nodes;
}

const types = (o: Record<string, unknown>) => [o["@type"]].flat().filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase());
const nameOf = (o: unknown) => (o && typeof o === "object" && typeof (o as { name?: unknown }).name === "string" ? clean((o as { name: string }).name) : undefined);

/** og:site_name, then schema.org publisher/Organization, then WebSite name, then the domain. */
export function findPublisher(html: string, domain: string): string {
  const nodes = jsonLdNodes(html);
  const candidates = [
    metaContent(html, ["og:site_name"]),
    ...nodes.map((n) => nameOf(n.publisher)),
    ...nodes.filter((n) => types(n).some((t) => ORG_TYPES.has(t))).map(nameOf),
    ...nodes.filter((n) => types(n).includes("website")).map(nameOf),
    metaContent(html, ["application-name"]),
  ];
  const found = candidates.find((c) => c && c.length <= 120 && !EMAIL.test(c));
  return found ?? domain;
}

function links(html: string, base: URL): Link[] {
  const baseTag = /<base\b[^>]*>/i.exec(html);
  let root = base;
  if (baseTag) {
    try {
      root = new URL(attrs(baseTag[0]).href ?? "", base);
    } catch {
      root = base;
    }
  }
  const out: Link[] = [];
  for (const m of withoutComments(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const a = attrs(`<a ${m[1]}>`);
    if (!a.href) continue;
    let url: URL;
    try {
      url = new URL(a.href.trim(), root);
    } catch {
      continue;
    }
    const text = clean(m[2].replace(/<[^>]+>/g, " ")) || clean(a["aria-label"] ?? a.title ?? "");
    out.push({ url, text, rel: (a.rel ?? "").toLowerCase() });
  }
  return out;
}

const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, "");

function sameSite(a: URL, b: URL): boolean {
  const x = host(a);
  const y = host(b);
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

const SOCIAL_HOSTS = /(^|\.)(linkedin\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com|youtube\.com|threads\.net|pinterest\.com|github\.com|medium\.com)$/i;
const PERSONAL_PATH = /\/(author|authors|people|person|profile|profiles|user|users|member|members|staff|team|about-the-author|in)\//i;
const LOGIN_PATH = /\/(login|log-in|signin|sign-in|account|my-account|wp-admin|auth)(\/|$)/i;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** A business route: http(s), no email anywhere, not a social or personal profile, not a login. */
export function businessRoute(u: URL): string | undefined {
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return undefined;
  const bare = `${u.origin}${u.pathname}`;
  // The query and fragment are dropped, so only the bare URL is checked.
  if (EMAIL.test(safeDecode(bare)) || bare.includes("@")) return undefined;
  if (SOCIAL_HOSTS.test(u.hostname) || PERSONAL_PATH.test(`${u.pathname}/`) || LOGIN_PATH.test(u.pathname)) return undefined;
  return bare;
}

const CONTACT_PATH = /\/(contact|contact-us|contactus|get-in-touch|kontakt)(\/|\.html?|\.php|$)/i;
const CONTACT_TEXT = /^(contact|contact us|get in touch|talk to us|reach us|business (enquiries|inquiries))$/i;

const SUBMIT_PATH =
  /\/(submit|submit-(a-|your-)?(tool|software|product|app|listing|company)|get-listed|get-featured|suggest(-a)?-(tool|product|software|app)|add-(your-)?(product|listing|company|software|tool|app)|list-your-[a-z-]+|claim(-your)?-(profile|listing|product)|for-vendors|vendors)(\/|\.html?|$)/i;
const SUBMIT_TEXT =
  /\b((submit|suggest|add|list|recommend)\s+(a|an|your|my)?\s*(tool|software|product|app|company|business|listing|startup|platform)|get\s+(listed|featured)|claim\s+(your\s+)?(free\s+)?(profile|listing|product)|for\s+vendors)\b/i;
const FORM_HOSTS = /(^|\.)(forms\.gle|typeform\.com|tally\.so|airtable\.com|jotform\.com|forms\.office\.com|hsforms\.com)$/i;
const isFormHost = (u: URL) => FORM_HOSTS.test(u.hostname) || (host(u) === "docs.google.com" && u.pathname.startsWith("/forms/"));

const SPONSOR_PATH = /\/(advertise|advertising|advertise-with-us|sponsor|sponsors|sponsorship|sponsorships|media-kit|mediakit)(\/|\.html?|$)/i;
const SPONSOR_TEXT = /\b(advertise( with us)?|advertising|sponsorships?|become a sponsor|sponsor us|media kit)\b/i;

const AFFILIATE_TEXT = [
  /\baffiliate (links?|commissions?|disclosure|partners?|programs?|programmes?|relationships?)\b/i,
  /\bwe (may )?(earn|receive|get) (a )?(small |modest )?(commission|referral fee)/i,
  /\bcommission (if|when) you\b/i,
  /\b(partner|referral) program(me)?s?\b/i,
  /\bas an? (amazon )?(associate|affiliate)\b/i,
];
const AFFILIATE_PATH = /\/(affiliates?|affiliate-program|partners?|partner-program|referral-program)(\/|\.html?|$)/i;
const AFFILIATE_HOSTS =
  /(^|\.)(partnerstack\.com|impact\.com|shareasale\.com|awin1\.com|anrdoezrs\.net|tkqlhce\.com|dpbolvw\.net|go2cloud\.org|rewardful\.com|firstpromoter\.com|tapfiliate\.com|pxf\.io|sjv\.io)$/i;
const AFFILIATE_PARAM = /^(ref|via|aff|aff_id|affiliate|affiliate_id|fpr|irclickid|clickref)$/i;

function pick(all: Link[], page: URL, path: RegExp, text: RegExp, allowForms = false): string | undefined {
  const eligible = all.filter((l) => sameSite(l.url, page) || (allowForms && isFormHost(l.url)));
  const ordered = [
    ...eligible.filter((l) => path.test(l.url.pathname) && text.test(l.text)),
    ...eligible.filter((l) => path.test(l.url.pathname)),
    ...eligible.filter((l) => text.test(l.text)),
  ];
  for (const l of ordered) {
    const route = businessRoute(l.url);
    if (route) return route;
  }
  return undefined;
}

function affiliateSignal(text: string, all: Link[]): string | undefined {
  for (const re of AFFILIATE_TEXT) {
    const m = re.exec(text);
    if (m) {
      const start = Math.max(0, m.index - 40);
      return `text: …${text.slice(start, m.index + m[0].length + 40).trim()}…`;
    }
  }
  for (const l of all) {
    if (/\bsponsored\b/.test(l.rel)) return `link rel=sponsored: ${l.url.hostname}`;
    if (AFFILIATE_HOSTS.test(l.url.hostname)) return `affiliate network link: ${l.url.hostname}`;
    if (AFFILIATE_PATH.test(l.url.pathname)) return `link: ${businessRoute(l.url) ?? l.url.hostname}`;
    if ([...l.url.searchParams.keys()].some((k) => AFFILIATE_PARAM.test(k))) return `referral parameter on a link to ${l.url.hostname}`;
  }
  return undefined;
}

export function extractPageFacts(html: string, pageUrl: string, brands: Brand[]): PageFacts {
  const page = new URL(pageUrl);
  const all = links(html, page);
  const text = visibleText(html);
  const affiliateEvidence = affiliateSignal(text, all);
  const facts: PageFacts = {
    publisher: findPublisher(html, host(page)),
    contactUrl: pick(all, page, CONTACT_PATH, CONTACT_TEXT),
    submissionUrl: pick(all, page, SUBMIT_PATH, SUBMIT_TEXT, true),
    sponsorshipUrl: pick(all, page, SPONSOR_PATH, SPONSOR_TEXT),
    ...(affiliateEvidence ? { affiliateProgram: true as const, affiliateEvidence: affiliateEvidence.replace(/\S*@\S*/g, "[email]") } : {}),
    brandsMentioned: extractBrandsByAlias(text, brands).map((m) => m.brand),
  };
  for (const key of ["contactUrl", "submissionUrl", "sponsorshipUrl"] as const) if (facts[key] === undefined) delete facts[key];
  return facts;
}
