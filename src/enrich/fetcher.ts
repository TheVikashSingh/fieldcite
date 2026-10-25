// Polite fetcher for publicly cited pages (SPEC M-2, §10). No API cost, but strict manners:
// robots.txt first (cached per origin), an identifying User-Agent, at most 1 request per domain
// every 10 s, a few requests in flight overall, a 10 s timeout, a 2 MB body cap, HTML only,
// one retry on 5xx only, no cookies or credentials, and nothing that gets around bot protection.

import type { Env } from "../engines/guard";
import { ALLOW_ALL, DISALLOW_ALL, isAllowed, parseRobots, type RobotsPolicy } from "./robots";

export const PRODUCT_TOKEN = "FieldCiteBot";
export const BOT_VERSION = "0.1";
export const DEFAULT_CONTACT_URL = "https://github.com/TheVikashSingh/fieldcite";

export interface FetcherConfig {
  userAgent: string;
  perDomainIntervalMs: number;
  maxInFlight: number;
  timeoutMs: number;
  maxBodyBytes: number;
  maxRedirects: number;
  /** robots.txt files are read up to this size (RFC 9309 asks for at least 500 KiB). */
  maxRobotsBytes: number;
  robotsTtlMs: number;
}

/** "FieldCiteBot/0.1 (+<contact URL>)". The contact URL comes from ENRICH_CONTACT_URL. */
export function userAgentFor(env: Env = process.env): string {
  const contact = env.ENRICH_CONTACT_URL?.trim();
  const url = contact && /^https?:\/\/[^\s()]+$/i.test(contact) ? contact : DEFAULT_CONTACT_URL;
  return `${PRODUCT_TOKEN}/${BOT_VERSION} (+${url})`;
}

export const DEFAULT_FETCHER_CONFIG: Omit<FetcherConfig, "userAgent"> = {
  perDomainIntervalMs: 10_000,
  maxInFlight: 3,
  timeoutMs: 10_000,
  maxBodyBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  maxRobotsBytes: 512 * 1024,
  robotsTtlMs: 24 * 60 * 60 * 1000,
};

export type FetchFailure =
  | "bad_url"
  | "robots_disallowed"
  | "not_html"
  | "too_large"
  | "timeout"
  | "http_error"
  | "network_error"
  | "too_many_redirects";

export type FetchOutcome =
  | { ok: true; url: string; finalUrl: string; status: number; html: string }
  | { ok: false; url: string; reason: FetchFailure; status?: number };

export interface PageFetcher {
  fetchPage(url: string): Promise<FetchOutcome>;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

type Attempt =
  | { kind: "html"; status: number; html: string }
  | { kind: "redirect"; location: string }
  | { kind: "fail"; reason: FetchFailure; status?: number };

class TimeoutError extends Error {}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The pacing key: hostname without "www.". */
export const domainKey = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, "");

const HTML_TYPE = /^\s*(text\/html|application\/xhtml\+xml)\s*(;|$)/i;

export class PoliteFetcher implements PageFetcher {
  readonly config: FetcherConfig;
  private readonly fetchFn: FetchFn | undefined;
  private readonly domainLocks = new Map<string, Promise<void>>();
  private readonly lastStart = new Map<string, number>();
  private readonly robots = new Map<string, { policy: Promise<RobotsPolicy>; at: number }>();
  private inFlight = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(opts: { fetch?: FetchFn; config?: Partial<FetcherConfig>; env?: Env } = {}) {
    this.fetchFn = opts.fetch;
    this.config = { ...DEFAULT_FETCHER_CONFIG, userAgent: userAgentFor(opts.env), ...opts.config };
  }

  async fetchPage(url: string): Promise<FetchOutcome> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { ok: false, url, reason: "bad_url" };
    }
    // Public pages only: no other schemes and no credentials in the URL.
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return { ok: false, url, reason: "bad_url" };

    for (let hop = 0; hop <= this.config.maxRedirects; hop++) {
      const policy = await this.robotsFor(u);
      if (!isAllowed(policy, u.pathname + u.search)) return { ok: false, url, reason: "robots_disallowed" };

      const target = u;
      let attempt = await this.paced(domainKey(target), () => this.getOnce(target));
      // One retry, on 5xx only, still paced (CS-5 spirit: no retry loops).
      if (attempt.kind === "fail" && attempt.reason === "http_error" && (attempt.status ?? 0) >= 500) {
        attempt = await this.paced(domainKey(target), () => this.getOnce(target));
      }

      if (attempt.kind === "html") return { ok: true, url, finalUrl: u.href, status: attempt.status, html: attempt.html };
      if (attempt.kind === "fail") return { ok: false, url, reason: attempt.reason, status: attempt.status };
      try {
        u = new URL(attempt.location, u);
      } catch {
        return { ok: false, url, reason: "bad_url" };
      }
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) return { ok: false, url, reason: "bad_url" };
    }
    return { ok: false, url, reason: "too_many_redirects" };
  }

  private get fetch(): FetchFn {
    return this.fetchFn ?? ((url, init) => globalThis.fetch(url, init));
  }

  private headers(accept: string): Record<string, string> {
    return { "User-Agent": this.config.userAgent, Accept: accept, "Accept-Language": "en" };
  }

  private async getOnce(u: URL): Promise<Attempt> {
    try {
      return await this.timed(async (signal) => {
        const res = await this.fetch(u.href, {
          method: "GET",
          headers: this.headers("text/html,application/xhtml+xml;q=0.9"),
          redirect: "manual",
          credentials: "omit",
          signal,
        });
        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && location) {
          await res.body?.cancel();
          return { kind: "redirect", location };
        }
        if (!res.ok) {
          await res.body?.cancel();
          return { kind: "fail", reason: "http_error", status: res.status };
        }
        if (!HTML_TYPE.test(res.headers.get("content-type") ?? "")) {
          await res.body?.cancel();
          return { kind: "fail", reason: "not_html", status: res.status };
        }
        const html = await readCapped(res, this.config.maxBodyBytes);
        if (html === null) return { kind: "fail", reason: "too_large", status: res.status };
        return { kind: "html", status: res.status, html };
      });
    } catch (err) {
      return { kind: "fail", reason: err instanceof TimeoutError ? "timeout" : "network_error" };
    }
  }

  private robotsFor(u: URL): Promise<RobotsPolicy> {
    const cached = this.robots.get(u.origin);
    if (cached && Date.now() - cached.at < this.config.robotsTtlMs) return cached.policy;
    const policy = this.paced(domainKey(u), () => this.loadRobots(u.origin));
    this.robots.set(u.origin, { policy, at: Date.now() });
    return policy;
  }

  /** RFC 9309: 4xx means no rules; 5xx, 429, timeouts and network errors mean "disallow all". */
  private async loadRobots(origin: string): Promise<RobotsPolicy> {
    try {
      return await this.timed(async (signal) => {
        const res = await this.fetch(`${origin}/robots.txt`, {
          method: "GET",
          headers: this.headers("text/plain"),
          redirect: "follow",
          credentials: "omit",
          signal,
        });
        if (res.status >= 200 && res.status < 300) {
          const text = await readCapped(res, this.config.maxRobotsBytes, true);
          return parseRobots(text ?? "", PRODUCT_TOKEN);
        }
        await res.body?.cancel();
        if (res.status >= 400 && res.status < 500 && res.status !== 429) return ALLOW_ALL;
        return DISALLOW_ALL;
      });
    } catch {
      return DISALLOW_ALL;
    }
  }

  /** The timeout covers the whole request, body included. */
  private async timed<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new TimeoutError("timeout"));
      }, this.config.timeoutMs);
    });
    const work = fn(ctrl.signal);
    work.catch(() => {}); // a late rejection after the timeout is expected, not unhandled
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** One request per domain at a time, starts at least perDomainIntervalMs apart, and a global cap. */
  private async paced<T>(domain: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.domainLocks.get(domain) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    const tail = prev.then(() => mine);
    this.domainLocks.set(domain, tail);
    await prev;
    try {
      const last = this.lastStart.get(domain);
      if (last !== undefined) {
        const wait = last + this.config.perDomainIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
      }
      await this.acquire();
      try {
        this.lastStart.set(domain, Date.now());
        return await fn();
      } finally {
        this.releaseSlot();
      }
    } finally {
      release();
      if (this.domainLocks.get(domain) === tail) this.domainLocks.delete(domain);
    }
  }

  private async acquire(): Promise<void> {
    if (this.inFlight < this.config.maxInFlight) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.inFlight--;
  }
}

/** Reads at most `cap` bytes. Returns null when the body is bigger, or the first `cap` bytes if `truncate`. */
async function readCapped(res: Response, cap: number, truncate = false): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (!truncate && Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      if (!truncate) return null;
      chunks.push(value.subarray(0, value.byteLength - (total - cap)));
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
