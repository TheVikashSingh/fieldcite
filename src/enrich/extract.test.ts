import { describe, expect, it } from "vitest";
import type { Brand } from "../extract/brands";
import { businessRoute, extractPageFacts, findPublisher, visibleText } from "./extract";

const BRANDS: Brand[] = [
  { name: "GorillaDesk", domain: "gorilladesk.com" },
  { name: "Jobber", domain: "getjobber.com" },
  { name: "Housecall Pro", domain: "housecallpro.com", aliases: ["HousecallPro"] },
  { name: "ServiceTitan", domain: "servicetitan.com" },
];

const PAGE = "https://www.blog.test/best-pest-control-software";
const page = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("publisher", () => {
  it("prefers og:site_name, then schema.org data, then the domain", () => {
    const org = `<script type="application/ld+json">{"@graph": [{"@type": "WebSite", "name": "Site Name"}, {"@type": "Organization", "name": "Org &amp; Co"}]}</script>`;
    const article = `<script type="application/ld+json">{"@type": "Article", "publisher": {"@type": "Organization", "name": "Article Publisher"}}</script>`;
    expect(findPublisher(page(`<meta property="og:site_name" content="OG Name">${org}`, ""), "blog.test")).toBe("OG Name");
    expect(findPublisher(page(org, ""), "blog.test")).toBe("Org & Co");
    expect(findPublisher(page(article, ""), "blog.test")).toBe("Article Publisher");
    expect(findPublisher(page(`<script type="application/ld+json">{"@type": "WebSite", "name": "Site Name"}</script>`, ""), "blog.test")).toBe("Site Name");
    expect(findPublisher(page(`<script type="application/ld+json">{broken</script>`, ""), "blog.test")).toBe("blog.test");
    expect(findPublisher(page(`<meta property="og:site_name" content="someone@example.com">`, ""), "blog.test")).toBe("blog.test");
  });
});

describe("links", () => {
  it("finds a same-site business contact page and ignores personal routes", () => {
    const html = page(
      "",
      `<a href="mailto:jane.doe@example.com">Contact Jane</a>
       <a href="https://www.linkedin.com/in/jane-doe">Contact me on LinkedIn</a>
       <a href="/author/jane-doe/">Jane Doe</a>
       <a href="https://other.test/contact">Contact</a>
       <a href="/contact-us/?utm_source=x&email=jane%40example.com#form">Contact us</a>`,
    );
    expect(extractPageFacts(html, PAGE, BRANDS).contactUrl).toBe("https://www.blog.test/contact-us/");
  });

  it("finds a submission page on the site or a known form host, not elsewhere", () => {
    const onSite = page("", `<a href="/get-listed">Get listed</a>`);
    expect(extractPageFacts(onSite, PAGE, BRANDS).submissionUrl).toBe("https://www.blog.test/get-listed");
    const form = page("", `<a href="https://docs.google.com/forms/d/e/abc/viewform?usp=sf">Suggest a tool</a>`);
    expect(extractPageFacts(form, PAGE, BRANDS).submissionUrl).toBe("https://docs.google.com/forms/d/e/abc/viewform");
    const elsewhere = page("", `<a href="https://random.test/submit">Submit your software</a>`);
    expect(extractPageFacts(elsewhere, PAGE, BRANDS).submissionUrl).toBeUndefined();
    const claim = page("", `<a href="/vendors/claim">Claim your profile</a> <a href="/login">Vendor login</a>`);
    expect(extractPageFacts(claim, PAGE, BRANDS).submissionUrl).toBe("https://www.blog.test/vendors/claim");
  });

  it("finds a sponsorship or advertise page", () => {
    expect(extractPageFacts(page("", `<a href="/media-kit">Media kit</a>`), PAGE, BRANDS).sponsorshipUrl).toBe("https://www.blog.test/media-kit");
    expect(extractPageFacts(page("", `<a href="/work/ads">Advertise with us</a>`), PAGE, BRANDS).sponsorshipUrl).toBe("https://www.blog.test/work/ads");
    expect(extractPageFacts(page("", `<a href="/about">About</a>`), PAGE, BRANDS).sponsorshipUrl).toBeUndefined();
  });

  it("resolves links against <base href>", () => {
    const html = page(`<base href="https://www.blog.test/en/">`, `<a href="contact">Contact</a>`);
    expect(extractPageFacts(html, PAGE, BRANDS).contactUrl).toBe("https://www.blog.test/en/contact");
  });
});

describe("affiliate program", () => {
  it.each([
    ["disclosure text", `<p>This post contains affiliate links.</p>`],
    ["commission text", `<p>We may earn a commission when you buy.</p>`],
    ["rel=sponsored", `<a href="https://gorilladesk.com/" rel="sponsored nofollow">Try it</a>`],
    ["referral parameter", `<a href="https://getjobber.com/?via=blog">Jobber</a>`],
    ["affiliate network", `<a href="https://jobber.partnerstack.com/x">Jobber</a>`],
    ["partner program link", `<a href="/partners/">Partners</a>`],
  ])("is detected from %s", (_, body) => {
    const facts = extractPageFacts(page("", body), PAGE, BRANDS);
    expect(facts.affiliateProgram).toBe(true);
    expect(facts.affiliateEvidence).toBeTruthy();
  });

  it("stays unknown without a signal", () => {
    const facts = extractPageFacts(page("", `<p>Plain review. <a href="https://getjobber.com/">Jobber</a></p>`), PAGE, BRANDS);
    expect(facts.affiliateProgram).toBeUndefined();
    expect("affiliateProgram" in facts).toBe(false);
  });
});

describe("brands", () => {
  it("finds known brands in visible text only", () => {
    const html = page(
      `<title>x</title><script>var s = "ServiceTitan";</script><style>.Jobber{}</style>`,
      `<h2>1. GorillaDesk</h2><p>HousecallPro is <b>also</b> good.</p><!-- Jobber -->`,
    );
    expect(extractPageFacts(html, PAGE, BRANDS).brandsMentioned).toEqual(["GorillaDesk", "Housecall Pro"]);
    expect(visibleText(html)).not.toMatch(/ServiceTitan|Jobber/);
  });
});

describe("personal data (SPEC §10)", () => {
  it("never returns an email address or a personal profile in any field", () => {
    const html = page(
      `<meta property="og:site_name" content="Blog">`,
      `<p>Questions? Write to jane.doe@example.com. As an affiliate, contact me at jane.doe@example.com.</p>
       <a href="mailto:jane.doe@example.com">Contact</a>
       <a href="/team/jane/">Contact</a>
       <a href="https://twitter.com/janedoe">Advertise</a>
       <a href="/contact?from=jane.doe@example.com">Submit your tool</a>`,
    );
    const facts = extractPageFacts(html, PAGE, BRANDS);
    expect(JSON.stringify(facts)).not.toMatch(/@|jane/i);
    expect(facts.affiliateProgram).toBe(true);
    expect(businessRoute(new URL("mailto:jane@example.com"))).toBeUndefined();
    expect(businessRoute(new URL("https://www.linkedin.com/company/x"))).toBeUndefined();
    expect(businessRoute(new URL("https://blog.test/u%40x.com/contact"))).toBeUndefined();
  });
});
