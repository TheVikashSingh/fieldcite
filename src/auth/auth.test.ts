import { describe, expect, it, vi } from "vitest";
import { ConsoleMailer, MailerConfigError, mailerFromEnv, MemoryMailer, RESEND_URL, ResendMailer } from "../email/mailer";
import { isSameOrigin } from "../server/origin";
import { confirmMagicLink, LINK_TTL_MINUTES, MAX_LINKS_PER_HOUR, safeNextPath, sendMagicLink, type MagicLinkDeps } from "./magic-link";
import { AuthConfigError, authSecret, decodeSession, encodeSession, SESSION_DAYS } from "./session";
import { MemoryAuthStore } from "./store";
import { hashToken, isToken, newToken, normalizeEmail } from "./tokens";

const SECRET = "test-secret-that-is-at-least-32-characters";
const T0 = new Date("2026-11-16T10:00:00Z");

function deps(now = T0): MagicLinkDeps & { store: MemoryAuthStore; mailer: MemoryMailer } {
  return { store: new MemoryAuthStore(), mailer: new MemoryMailer(), baseUrl: "https://app.example", now: () => now };
}

const tokenFrom = (url: string | null) => new URL(url!).searchParams.get("token")!;

describe("tokens", () => {
  it("are 256-bit, url-safe and stored only as a hash", () => {
    const t = newToken();
    expect(isToken(t)).toBe(true);
    expect(newToken()).not.toBe(t);
    expect(hashToken(t)).toHaveLength(32);
    expect(hashToken(t).toString("utf8")).not.toContain(t);
  });

  it("normalizes email addresses", () => {
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("a b@example.com")).toBeNull();
    expect(normalizeEmail(`${"a".repeat(250)}@x.com`)).toBeNull();
  });
});

describe("session cookie", () => {
  it("round-trips and expires after 30 days", () => {
    const value = encodeSession({ userId: "u1", email: "a@b.co" }, SECRET, T0);
    expect(decodeSession(value, SECRET, T0)).toMatchObject({ userId: "u1", email: "a@b.co" });
    const later = new Date(T0.getTime() + SESSION_DAYS * 24 * 3600 * 1000);
    expect(decodeSession(value, SECRET, later)).toBeNull();
  });

  it("rejects tampering and the wrong secret", () => {
    const value = encodeSession({ userId: "u1", email: "a@b.co" }, SECRET, T0);
    const [v, payload, sig] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "admin", e: "a@b.co", exp: 9e9 })).toString("base64url");
    expect(decodeSession(`${v}.${forged}.${sig}`, SECRET, T0)).toBeNull();
    expect(decodeSession(`${v}.${payload}.${sig.slice(0, -2)}xx`, SECRET, T0)).toBeNull();
    expect(decodeSession(value, `${SECRET}-other`, T0)).toBeNull();
    expect(decodeSession("garbage", SECRET, T0)).toBeNull();
    expect(decodeSession(undefined, SECRET, T0)).toBeNull();
  });

  it("requires a long AUTH_SECRET", () => {
    expect(() => authSecret({ AUTH_SECRET: "short" })).toThrow(AuthConfigError);
    expect(() => authSecret({})).toThrow(AuthConfigError);
    expect(authSecret({ AUTH_SECRET: SECRET })).toBe(SECRET);
  });
});

describe("magic links (F-9)", () => {
  it("emails a one-time link, then signs in a verified user with an account", async () => {
    const d = deps();
    expect(await sendMagicLink(d, { email: "owner@vendor.com", purpose: "login", payload: { next: "/account" } })).toBe("sent");
    const url = d.mailer.lastLinkTo("owner@vendor.com");
    expect(url).toMatch(/^https:\/\/app\.example\/auth\/verify\?token=[A-Za-z0-9_-]{43}$/);
    expect(d.mailer.sent[0].subject).toContain("sign-in");

    const confirmed = await confirmMagicLink(d, tokenFrom(url));
    expect(confirmed).toMatchObject({ email: "owner@vendor.com", purpose: "login", payload: { next: "/account" } });
    expect(d.store.accounts.get(confirmed!.userId)?.id).toBe(confirmed!.accountId);
  });

  it("never stores the token itself", async () => {
    const d = deps();
    await sendMagicLink(d, { email: "owner@vendor.com", purpose: "login" });
    const token = tokenFrom(d.mailer.lastLinkTo("owner@vendor.com"));
    expect(JSON.stringify(d.store.links)).not.toContain(token);
  });

  it("works only once", async () => {
    const d = deps();
    await sendMagicLink(d, { email: "owner@vendor.com", purpose: "login" });
    const token = tokenFrom(d.mailer.lastLinkTo("owner@vendor.com"));
    expect(await confirmMagicLink(d, token)).not.toBeNull();
    expect(await confirmMagicLink(d, token)).toBeNull();
  });

  it("expires after 15 minutes", async () => {
    const d = deps();
    await sendMagicLink(d, { email: "owner@vendor.com", purpose: "login" });
    const token = tokenFrom(d.mailer.lastLinkTo("owner@vendor.com"));
    const late = new Date(T0.getTime() + LINK_TTL_MINUTES * 60 * 1000);
    expect(await confirmMagicLink({ store: d.store, now: () => late }, token)).toBeNull();
  });

  it("rejects malformed and unknown tokens", async () => {
    const d = deps();
    expect(await confirmMagicLink(d, "")).toBeNull();
    expect(await confirmMagicLink(d, "../../etc")).toBeNull();
    expect(await confirmMagicLink(d, newToken())).toBeNull();
  });

  it("sends at most 5 links per address per hour", async () => {
    const d = deps();
    for (let i = 0; i < MAX_LINKS_PER_HOUR; i++) expect(await sendMagicLink(d, { email: "a@b.co", purpose: "login" })).toBe("sent");
    expect(await sendMagicLink(d, { email: "a@b.co", purpose: "free_scan" })).toBe("rate_limited");
    expect(d.mailer.sent).toHaveLength(MAX_LINKS_PER_HOUR);
    // Other addresses are unaffected, and the limit resets after an hour.
    expect(await sendMagicLink(d, { email: "c@d.co", purpose: "login" })).toBe("sent");
    const hourLater = { ...d, now: () => new Date(T0.getTime() + 60 * 60 * 1000 + 1) };
    expect(await sendMagicLink(hourLater, { email: "a@b.co", purpose: "login" })).toBe("sent");
  });

  it("only allows same-site paths after login", () => {
    expect(safeNextPath("/account")).toBe("/account");
    expect(safeNextPath("/r/abc?x=1")).toBe("/r/abc?x=1");
    expect(safeNextPath("https://evil.example")).toBe("/account");
    expect(safeNextPath("//evil.example")).toBe("/account");
    expect(safeNextPath("/\\evil.example")).toBe("/account");
    expect(safeNextPath(undefined)).toBe("/account");
  });
});

describe("mailer", () => {
  it("sends through Resend with the key in a header", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    await new ResendMailer("re_test", "FieldCite <hi@fieldcite.test>", fetchFn).send({ to: "a@b.co", subject: "S", text: "T" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_URL);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toEqual({ from: "FieldCite <hi@fieldcite.test>", to: ["a@b.co"], subject: "S", text: "T" });
  });

  it("throws when Resend refuses", async () => {
    const fetchFn = async () => new Response("bad", { status: 422 });
    await expect(new ResendMailer("re_test", "x@y.co", fetchFn).send({ to: "a@b.co", subject: "S", text: "T" })).rejects.toThrow("422");
  });

  it("logs links in development and refuses to run without Resend in production", () => {
    expect(mailerFromEnv({})).toBeInstanceOf(ConsoleMailer);
    expect(() => mailerFromEnv({ NODE_ENV: "production" })).toThrow(MailerConfigError);
    expect(() => mailerFromEnv({ RESEND_API_KEY: "re_x" })).toThrow(MailerConfigError);
    expect(mailerFromEnv({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.co" })).toBeInstanceOf(ResendMailer);
  });
});

describe("same-origin check", () => {
  it("accepts the app's own origin only", () => {
    const url = "https://app.example/auth/confirm";
    expect(isSameOrigin(new Headers({ origin: "https://app.example" }), url)).toBe(true);
    expect(isSameOrigin(new Headers({ referer: "https://app.example/auth/verify?token=x" }), url)).toBe(true);
    expect(isSameOrigin(new Headers({ origin: "https://evil.example" }), url)).toBe(false);
    expect(isSameOrigin(new Headers(), url)).toBe(false);
  });
});
