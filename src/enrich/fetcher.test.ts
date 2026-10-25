import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoliteFetcher, userAgentFor } from "./fetcher";
import { isAllowed, parseRobots } from "./robots";

interface Call {
  url: string;
  at: number;
  init: RequestInit;
}

type Route = (init: RequestInit) => Response | Promise<Response>;

/** A mocked network: routes by full URL; robots.txt is a 404 (no rules) unless routed. */
function mockNet(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, at: Date.now(), init });
    const route = routes[url];
    if (route) return route(init);
    if (url.endsWith("/robots.txt")) return new Response("not found", { status: 404 });
    return html("<html><body>ok</body></html>");
  });
  return { fetch, calls, pages: () => calls.filter((c) => !c.url.endsWith("/robots.txt")) };
}

const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, ...init, headers: { "content-type": "text/html; charset=utf-8", ...(init.headers as Record<string, string>) } });

const robots = (text: string) => () => new Response(text, { status: 200, headers: { "content-type": "text/plain" } });

/** Rejects when the request is aborted, like a real fetch; never resolves otherwise. */
const hang = (init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-11-16T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

/** Starts the work, lets every timer fire, and returns the result. */
async function settle<T>(work: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return work;
}

describe("robots.txt", () => {
  it("parses groups, prefers our own group, and uses the longest match", () => {
    const text = "User-agent: *\nDisallow: /\n\nUser-agent: FieldCiteBot\nUser-agent: other\nDisallow: /private\nAllow: /private/ok$\nDisallow: /*.pdf$\n";
    const policy = parseRobots(text, "FieldCiteBot");
    expect(isAllowed(policy, "/blog/post")).toBe(true);
    expect(isAllowed(policy, "/private/x")).toBe(false);
    expect(isAllowed(policy, "/private/ok")).toBe(true);
    expect(isAllowed(policy, "/files/a.pdf")).toBe(false);
    expect(isAllowed(policy, "/robots.txt")).toBe(true);
    expect(isAllowed(parseRobots(text, "SomeOtherBot"), "/blog/post")).toBe(false);
    expect(isAllowed(parseRobots("User-agent: *\nDisallow:\n", "FieldCiteBot"), "/anything")).toBe(true);
  });

  it("skips disallowed paths without requesting them", async () => {
    const net = mockNet({ "https://a.test/robots.txt": robots("User-agent: *\nDisallow: /private/\n") });
    const fetcher = new PoliteFetcher({ fetch: net.fetch });
    const out = await settle(fetcher.fetchPage("https://a.test/private/page"));
    expect(out).toMatchObject({ ok: false, reason: "robots_disallowed" });
    expect(net.pages()).toHaveLength(0);
  });

  it("is fetched once per origin and cached", async () => {
    const net = mockNet({ "https://a.test/robots.txt": robots("User-agent: *\nDisallow: /x\n") });
    const fetcher = new PoliteFetcher({ fetch: net.fetch });
    await settle(Promise.all([fetcher.fetchPage("https://a.test/1"), fetcher.fetchPage("https://a.test/2"), fetcher.fetchPage("https://a.test/x")]));
    expect(net.calls.filter((c) => c.url.endsWith("/robots.txt"))).toHaveLength(1);
    expect(net.pages().map((c) => c.url).sort()).toEqual(["https://a.test/1", "https://a.test/2"]);
  });

  it("treats an unreachable robots.txt (5xx, 429, network error) as disallow-all and a 4xx as allow-all", async () => {
    const net = mockNet({
      "https://five.test/robots.txt": () => new Response("down", { status: 503 }),
      "https://slow.test/robots.txt": () => new Response("busy", { status: 429 }),
      "https://err.test/robots.txt": () => Promise.reject(new TypeError("fetch failed")),
      "https://gone.test/robots.txt": () => new Response("gone", { status: 410 }),
    });
    const fetcher = new PoliteFetcher({ fetch: net.fetch });
    const outs = await settle(Promise.all(["five", "slow", "err", "gone"].map((d) => fetcher.fetchPage(`https://${d}.test/page`))));
    expect(outs.map((o) => (o.ok ? "ok" : o.reason))).toEqual(["robots_disallowed", "robots_disallowed", "robots_disallowed", "ok"]);
  });
});

describe("pacing", () => {
  it("allows at most 1 request per domain every 10 s, without slowing other domains", async () => {
    const net = mockNet({});
    const fetcher = new PoliteFetcher({ fetch: net.fetch });
    const t0 = Date.now();
    await settle(Promise.all([...["/1", "/2", "/3"].map((p) => fetcher.fetchPage(`https://a.test${p}`)), fetcher.fetchPage("https://www.b.test/1")]));
    const times = (host: string) => net.calls.filter((c) => new URL(c.url).hostname.endsWith(host)).map((c) => c.at - t0);
    // robots.txt counts as a request to the domain.
    expect(times("a.test")).toEqual([0, 10_000, 20_000, 30_000]);
    expect(times("b.test")).toEqual([0, 10_000]);
  });

  it("keeps a few requests in flight overall", async () => {
    let inFlight = 0;
    let peak = 0;
    const slow: Route = () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight--;
          resolve(html("<p>ok</p>"));
        }, 1000),
      );
    };
    const routes: Record<string, Route> = {};
    for (let i = 0; i < 8; i++) {
      routes[`https://d${i}.test/robots.txt`] = slow;
      routes[`https://d${i}.test/page`] = slow;
    }
    const fetcher = new PoliteFetcher({ fetch: mockNet(routes).fetch });
    const outs = await settle(Promise.all([...Array(8).keys()].map((i) => fetcher.fetchPage(`https://d${i}.test/page`))));
    expect(outs.every((o) => o.ok)).toBe(true);
    expect(peak).toBe(fetcher.config.maxInFlight);
    expect(fetcher.config.maxInFlight).toBeLessThanOrEqual(3);
  });
});

describe("requests", () => {
  it("identifies itself, sends no cookies or credentials, and doesn't follow redirects blindly", async () => {
    const net = mockNet({});
    const fetcher = new PoliteFetcher({ fetch: net.fetch, env: { ENRICH_CONTACT_URL: "https://fieldcite.example/bot" } });
    await settle(fetcher.fetchPage("https://a.test/page"));
    const page = net.pages()[0];
    const headers = page.init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("FieldCiteBot/0.1 (+https://fieldcite.example/bot)");
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("cookie");
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    expect(page.init.credentials).toBe("omit");
    expect(page.init.redirect).toBe("manual");
    expect(userAgentFor({ ENRICH_CONTACT_URL: "not a url" })).toBe("FieldCiteBot/0.1 (+https://github.com/TheVikashSingh/fieldcite)");
  });

  it("refuses non-http URLs and URLs with credentials", async () => {
    const fetcher = new PoliteFetcher({ fetch: mockNet({}).fetch });
    for (const url of ["ftp://a.test/x", "https://user:pw@a.test/x", "not a url"]) {
      expect(await settle(fetcher.fetchPage(url))).toMatchObject({ ok: false, reason: "bad_url" });
    }
  });

  it("follows a redirect after checking the new host's robots.txt", async () => {
    const net = mockNet({
      "https://a.test/old": () => new Response(null, { status: 301, headers: { location: "https://b.test/new" } }),
      "https://b.test/robots.txt": robots("User-agent: *\nDisallow: /new\n"),
    });
    const fetcher = new PoliteFetcher({ fetch: net.fetch });
    expect(await settle(fetcher.fetchPage("https://a.test/old"))).toMatchObject({ ok: false, reason: "robots_disallowed" });
    expect(net.pages().map((c) => c.url)).toEqual(["https://a.test/old"]);
  });

  it("times out after 10 s, body included", async () => {
    const net = mockNet({ "https://a.test/hang": hang });
    const fetcher = new PoliteFetcher({ fetch: net.fetch });
    const t0 = Date.now();
    const out = await settle(fetcher.fetchPage("https://a.test/hang"));
    expect(out).toMatchObject({ ok: false, reason: "timeout" });
    // robots at 0, page at 10 s, timeout 10 s later.
    expect(Date.now() - t0).toBe(20_000);

    const stalled = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("<html>"));
      },
    });
    const net2 = mockNet({ "https://c.test/slow-body": () => new Response(stalled, { headers: { "content-type": "text/html" } }) });
    expect(await settle(new PoliteFetcher({ fetch: net2.fetch }).fetchPage("https://c.test/slow-body"))).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("caps the body at 2 MB, declared or streamed", async () => {
    const mb = new Uint8Array(1024 * 1024).fill(97);
    const stream = (n: number) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < n; i++) c.enqueue(mb);
          c.close();
        },
      });
    const net = mockNet({
      "https://a.test/declared": () => html("x", { headers: { "content-length": String(3 * 1024 * 1024) } }),
      "https://b.test/streamed": () => new Response(stream(3), { headers: { "content-type": "text/html" } }),
      "https://c.test/fits": () => new Response(stream(2), { headers: { "content-type": "text/html" } }),
    });
    const fetcher = new PoliteFetcher({ fetch: net.fetch });
    const [declared, streamed, fits] = await settle(
      Promise.all(["https://a.test/declared", "https://b.test/streamed", "https://c.test/fits"].map((u) => fetcher.fetchPage(u))),
    );
    expect(declared).toMatchObject({ ok: false, reason: "too_large" });
    expect(streamed).toMatchObject({ ok: false, reason: "too_large" });
    expect(fits.ok && fits.html.length).toBe(2 * 1024 * 1024);
  });

  it("only accepts HTML", async () => {
    const net = mockNet({ "https://a.test/file.pdf": () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }) });
    expect(await settle(new PoliteFetcher({ fetch: net.fetch }).fetchPage("https://a.test/file.pdf"))).toMatchObject({ ok: false, reason: "not_html" });
  });

  it("retries once on 5xx only", async () => {
    let n = 0;
    const net = mockNet({
      "https://a.test/flaky": () => (n++ === 0 ? new Response("err", { status: 503 }) : html("<p>ok</p>")),
      "https://b.test/down": () => new Response("err", { status: 500 }),
      "https://c.test/missing": () => new Response("no", { status: 404 }),
      "https://d.test/blocked": () => new Response("no", { status: 403 }),
    });
    const fetcher = new PoliteFetcher({ fetch: net.fetch });
    const outs = await settle(Promise.all(["a.test/flaky", "b.test/down", "c.test/missing", "d.test/blocked"].map((u) => fetcher.fetchPage(`https://${u}`))));
    expect(outs.map((o) => (o.ok ? "ok" : `${o.reason} ${o.status}`))).toEqual(["ok", "http_error 500", "http_error 404", "http_error 403"]);
    const count = (host: string) => net.pages().filter((c) => c.url.includes(host)).length;
    expect([count("a.test"), count("b.test"), count("c.test"), count("d.test")]).toEqual([2, 2, 1, 1]);
  });
});
