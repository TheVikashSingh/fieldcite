import { describe, expect, it, vi } from "vitest";
import { MemoryAuthStore } from "../auth/store";
import { MemoryMailer } from "../email/mailer";
import { isDisposableEmail } from "./disposable";
import { FREE_SCAN, hashIp, normalizeDomain, submitFreeScan, type FreeScanDeps, type FreeScanInput } from "./request";
import { withCustomerBrand } from "./run";
import { findCategory } from "./categories";
import { MemoryFreeScanStore } from "./store";
import { CloudflareTurnstile, SITEVERIFY_URL, SKIP_TURNSTILE, TurnstileConfigError, turnstileFromEnv } from "./turnstile";

const T0 = new Date("2026-11-16T10:00:00Z");
const KEY = "ip-hash-key-for-tests-0123456789abcdef";

const INPUT: FreeScanInput = {
  email: "Owner@Briostack.com",
  domain: "https://www.briostack.com/pricing",
  brandName: "Briostack",
  categorySlug: "pest-control",
  country: "US",
  competitors: ["GorillaDesk", "PestPac"],
  turnstileToken: "token-from-widget",
  ip: "203.0.113.7",
};

function setup(overrides: Partial<FreeScanDeps> = {}) {
  const store = new MemoryFreeScanStore();
  const mailer = new MemoryMailer();
  const deps: FreeScanDeps = {
    store,
    turnstile: SKIP_TURNSTILE,
    magicLinks: { store: new MemoryAuthStore(), mailer, baseUrl: "https://app.example" },
    ipHashKey: KEY,
    env: {},
    now: () => T0,
    ...overrides,
  };
  return { deps, store, mailer };
}

describe("free-scan form checks (F-1, CS-11)", () => {
  it("stores a normalized request and emails a confirmation link; no scan starts yet", async () => {
    const { deps, store, mailer } = setup();
    expect(await submitFreeScan(INPUT, deps)).toEqual({ ok: true });
    expect(store.requests).toHaveLength(1);
    expect(store.requests[0]).toMatchObject({ email: "owner@briostack.com", domain: "briostack.com", brandName: "Briostack", country: "US", competitors: ["GorillaDesk", "PestPac"] });
    expect(store.requests[0].ipHash.equals(hashIp("203.0.113.7", KEY))).toBe(true);
    expect(mailer.sent[0]).toMatchObject({ to: "owner@briostack.com", subject: "Confirm your free FieldCite scan" });
    expect(mailer.lastLinkTo("owner@briostack.com")).toMatch(/\/auth\/verify\?token=/);
  });

  it("honors the kill switch (CS-8)", async () => {
    const { deps, store } = setup({ env: { SCANS_ENABLED: "false" } });
    expect(await submitFreeScan(INPUT, deps)).toMatchObject({ ok: false, error: "paused" });
    expect(store.requests).toHaveLength(0);
  });

  it("refuses while the free breaker is tripped (CS-7)", async () => {
    const { deps, store } = setup();
    store.paused = true;
    expect(await submitFreeScan(INPUT, deps)).toMatchObject({ ok: false, error: "paused" });
  });

  it("requires Turnstile to pass", async () => {
    const turnstile = { verify: vi.fn(async () => false) };
    const { deps, store } = setup({ turnstile });
    expect(await submitFreeScan(INPUT, deps)).toMatchObject({ ok: false, error: "captcha" });
    expect(turnstile.verify).toHaveBeenCalledWith("token-from-widget", "203.0.113.7");
    expect(store.requests).toHaveLength(0);
  });

  it("blocks disposable email addresses", async () => {
    const { deps } = setup();
    expect(await submitFreeScan({ ...INPUT, email: "x@mailinator.com" }, deps)).toMatchObject({ ok: false, error: "disposable", field: "email" });
    expect(await submitFreeScan({ ...INPUT, email: "x@eu.yopmail.com" }, deps)).toMatchObject({ ok: false, error: "disposable" });
  });

  it("allows at most 3 requests per IP per day", async () => {
    const { deps } = setup();
    for (let i = 0; i < FREE_SCAN.perIpPerDay; i++) {
      expect(await submitFreeScan({ ...INPUT, email: `p${i}@vendor${i}.com`, domain: `vendor${i}.com` }, deps)).toEqual({ ok: true });
    }
    expect(await submitFreeScan({ ...INPUT, email: "p9@vendor9.com", domain: "vendor9.com" }, deps)).toMatchObject({ ok: false, error: "ip_limit" });
    // Another IP is fine, and so is the same IP a day later.
    expect(await submitFreeScan({ ...INPUT, email: "p8@vendor8.com", domain: "vendor8.com", ip: "198.51.100.1" }, deps)).toEqual({ ok: true });
    const tomorrow = { ...deps, now: () => new Date(T0.getTime() + 24 * 3600 * 1000 + 1) };
    expect(await submitFreeScan({ ...INPUT, email: "p7@vendor7.com", domain: "vendor7.com" }, tomorrow)).toEqual({ ok: true });
  });

  it("allows 1 verified free scan per email and per domain every 30 days", async () => {
    const { deps, store } = setup();
    await submitFreeScan(INPUT, deps);
    store.requests[0].verifiedAt = T0;
    expect(await submitFreeScan({ ...INPUT, ip: "198.51.100.2" }, deps)).toMatchObject({ ok: false, error: "repeat" });
    expect(await submitFreeScan({ ...INPUT, email: "cto@briostack.com", ip: "198.51.100.3" }, deps)).toMatchObject({ ok: false, error: "repeat" });
    expect(await submitFreeScan({ ...INPUT, domain: "other-vendor.com", ip: "198.51.100.4" }, deps)).toMatchObject({ ok: false, error: "repeat" });
    const later = { ...deps, now: () => new Date(T0.getTime() + 30 * 24 * 3600 * 1000 + 1) };
    expect(await submitFreeScan({ ...INPUT, ip: "198.51.100.5" }, later)).toEqual({ ok: true });
  });

  it("an unverified request doesn't use up the 30-day allowance", async () => {
    const { deps } = setup();
    await submitFreeScan(INPUT, deps);
    expect(await submitFreeScan({ ...INPUT, ip: "198.51.100.6" }, deps)).toEqual({ ok: true });
  });

  it("validates every field", async () => {
    const { deps, store } = setup();
    expect(await submitFreeScan({ ...INPUT, email: "nope" }, deps)).toMatchObject({ field: "email" });
    expect(await submitFreeScan({ ...INPUT, domain: "not a domain" }, deps)).toMatchObject({ field: "domain" });
    expect(await submitFreeScan({ ...INPUT, brandName: "  " }, deps)).toMatchObject({ field: "brandName" });
    expect(await submitFreeScan({ ...INPUT, categorySlug: "../etc" }, deps)).toMatchObject({ field: "categorySlug" });
    expect(await submitFreeScan({ ...INPUT, country: "IN" }, deps)).toMatchObject({ field: "country" });
    expect(await submitFreeScan({ ...INPUT, competitors: ["GorillaDesk", "PestPac", "FieldRoutes", "Jobber"] }, deps)).toMatchObject({ field: "competitors" });
    expect(await submitFreeScan({ ...INPUT, competitors: ["Not A Brand"] }, deps)).toMatchObject({ field: "competitors" });
    expect(store.requests).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("normalizes company domains", () => {
    expect(normalizeDomain("https://www.GorillaDesk.com/pricing?x=1")).toBe("gorilladesk.com");
    expect(normalizeDomain("app.fieldroutes.com:443")).toBe("app.fieldroutes.com");
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("javascript:alert(1)")).toBeNull();
  });

  it("detects disposable domains and their subdomains only", () => {
    expect(isDisposableEmail("a@mailinator.com")).toBe(true);
    expect(isDisposableEmail("a@x.guerrillamail.com")).toBe(true);
    expect(isDisposableEmail("a@notmailinator.com")).toBe(false);
    expect(isDisposableEmail("a@briostack.com")).toBe(false);
  });

  it("hashes IPs with a key, never storing them", () => {
    expect(hashIp("203.0.113.7", KEY)).toHaveLength(32);
    expect(hashIp("203.0.113.7", KEY).equals(hashIp("203.0.113.7", `${KEY}x`))).toBe(false);
  });

  it("adds the customer's brand unless the category already lists it", () => {
    const pest = findCategory("pest-control")!;
    expect(withCustomerBrand(pest, "briostack", "other.com").target).toBe("Briostack");
    expect(withCustomerBrand(pest, "Brio", "briostack.com").target).toBe("Briostack");
    const added = withCustomerBrand(pest, "Acme Pest Pro", "acmepest.com");
    expect(added.target).toBe("Acme Pest Pro");
    expect(added.category.brands.at(-1)).toEqual({ name: "Acme Pest Pro", domain: "acmepest.com" });
    expect(pest.brands.some((b) => b.name === "Acme Pest Pro")).toBe(false);
  });
});

describe("Turnstile", () => {
  it("posts the token, secret and IP to siteverify and trusts only success: true", async () => {
    const fetchFn = vi.fn(async () => Response.json({ success: true }));
    expect(await new CloudflareTurnstile("secret-x", fetchFn).verify("tok", "203.0.113.7")).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({ secret: "secret-x", response: "tok", remoteip: "203.0.113.7" });
  });

  it("fails closed", async () => {
    expect(await new CloudflareTurnstile("s", async () => Response.json({ success: false })).verify("tok", null)).toBe(false);
    expect(await new CloudflareTurnstile("s", async () => new Response("err", { status: 500 })).verify("tok", null)).toBe(false);
    expect(await new CloudflareTurnstile("s", async () => Promise.reject(new Error("down"))).verify("tok", null)).toBe(false);
    expect(await new CloudflareTurnstile("s", async () => Response.json({ success: true })).verify("", null)).toBe(false);
  });

  it("is required in production", () => {
    expect(() => turnstileFromEnv({ NODE_ENV: "production" })).toThrow(TurnstileConfigError);
    expect(turnstileFromEnv({ TURNSTILE_SECRET_KEY: "s" })).toBeInstanceOf(CloudflareTurnstile);
    expect(turnstileFromEnv({})).toBe(SKIP_TURNSTILE);
  });
});
