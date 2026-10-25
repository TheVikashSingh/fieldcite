// The free-scan form's checks (SPEC F-1, CS-11), in order: kill switch, input, disposable email,
// Turnstile, breakers, per-IP limit, per-email and per-domain limit. Only then is a request
// stored and a confirmation link emailed. Nothing here calls an engine.

import { createHmac } from "node:crypto";
import { sendMagicLink, type MagicLinkDeps } from "../auth/magic-link";
import { normalizeEmail } from "../auth/tokens";
import { scansEnabled, type Env } from "../engines/guard";
import { COUNTRIES, type Country } from "../engines/types";
import { findCategory } from "./categories";
import { isDisposableEmail } from "./disposable";
import type { FreeScanRequestStore } from "./store";
import type { TurnstileVerifier } from "./turnstile";

export const FREE_SCAN = { questions: 5, runs: 1, maxCompetitors: 3, perIpPerDay: 3, repeatDays: 30 } as const;

export type FreeScanError = "paused" | "invalid" | "disposable" | "captcha" | "ip_limit" | "repeat";

export const ERROR_MESSAGES: Record<FreeScanError, string> = {
  paused: "Free scans are paused right now. Please try again tomorrow.",
  invalid: "Please check the form.",
  disposable: "Please use your work email address. Disposable addresses can't get a free scan.",
  captcha: "We couldn't confirm you're human. Please try again.",
  ip_limit: "Too many free scans from your network today. Please try again tomorrow.",
  repeat: "This email address or company domain already had a free scan in the last 30 days.",
};

export type FreeScanResult = { ok: true } | { ok: false; error: FreeScanError; field?: string; message: string };

export interface FreeScanInput {
  email: string;
  domain: string;
  brandName: string;
  categorySlug: string;
  country: string;
  competitors: string[];
  turnstileToken: string;
  ip: string | null;
}

export interface FreeScanDeps {
  store: FreeScanRequestStore;
  turnstile: TurnstileVerifier;
  magicLinks: MagicLinkDeps;
  /** Keys the IP hash, so stored hashes can't be reversed by trying every IP. */
  ipHashKey: string;
  env?: Env;
  now?: () => Date;
}

/** "https://www.GorillaDesk.com/pricing" → "gorilladesk.com"; null when it isn't a domain. */
export function normalizeDomain(value: string): string | null {
  let host = value.trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "");
  if (host.length > 253 || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host)) return null;
  return host;
}

export const hashIp = (ip: string | null, key: string): Buffer => createHmac("sha256", key).update(ip ?? "unknown").digest();

const fail = (error: FreeScanError, field?: string, message = ERROR_MESSAGES[error]): FreeScanResult => ({ ok: false, error, field, message });

export async function submitFreeScan(input: FreeScanInput, deps: FreeScanDeps): Promise<FreeScanResult> {
  const now = (deps.now ?? (() => new Date()))();
  // CS-8: no new free scans while the kill switch is off.
  if (!scansEnabled(deps.env ?? process.env)) return fail("paused");

  const email = normalizeEmail(input.email);
  if (!email) return fail("invalid", "email", "Enter a valid email address.");
  const domain = normalizeDomain(input.domain);
  if (!domain) return fail("invalid", "domain", "Enter your company's website, e.g. yourcompany.com.");
  const brandName = input.brandName.trim().replace(/\s+/g, " ");
  if (brandName.length < 1 || brandName.length > 80) return fail("invalid", "brandName", "Enter your product's name (up to 80 characters).");
  const category = findCategory(input.categorySlug);
  if (!category) return fail("invalid", "categorySlug", "Choose a category.");
  if (!(COUNTRIES as readonly string[]).includes(input.country)) return fail("invalid", "country", "Choose a country.");
  const known = new Set(category.brands.map((b) => b.name));
  const competitors = [...new Set(input.competitors.map((c) => c.trim()).filter(Boolean))];
  if (competitors.length > FREE_SCAN.maxCompetitors || competitors.some((c) => !known.has(c))) {
    return fail("invalid", "competitors", `Choose up to ${FREE_SCAN.maxCompetitors} competitors from the list.`);
  }

  if (isDisposableEmail(email)) return fail("disposable", "email");
  if (!(await deps.turnstile.verify(input.turnstileToken, input.ip))) return fail("captcha");
  if (await deps.store.freeScansPaused(now)) return fail("paused");

  const ipHash = hashIp(input.ip, deps.ipHashKey);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if ((await deps.store.countByIpSince(ipHash, dayAgo)) >= FREE_SCAN.perIpPerDay) return fail("ip_limit");
  const repeatSince = new Date(now.getTime() - FREE_SCAN.repeatDays * 24 * 60 * 60 * 1000);
  if ((await deps.store.countVerifiedSince(email, domain, repeatSince)) > 0) return fail("repeat");

  const requestId = await deps.store.createRequest({
    email,
    domain,
    brandName,
    categorySlug: category.slug,
    country: input.country as Country,
    competitors,
    ipHash,
    createdAt: now,
  });
  // A rate-limited address gets the same answer: the page never reveals anything about it.
  await sendMagicLink({ ...deps.magicLinks, now: () => now }, { email, purpose: "free_scan", payload: { requestId } });
  return { ok: true };
}
