import { describe, expect, it } from "vitest";
import type { Brand } from "./brands";
import { classifyCitation, domainOf } from "./classify";

const BRANDS: Brand[] = [
  { name: "Jobber", domain: "getjobber.com" },
  { name: "Housecall Pro", domain: "housecallpro.com" },
];

const type = (url: string, title?: string) => classifyCitation({ url, title }, BRANDS).pageType;

describe("citation page-type classification", () => {
  it("detects video pages", () => {
    expect(type("https://www.youtube.com/watch?v=abc")).toBe("video");
    expect(type("https://youtu.be/abc")).toBe("video");
    expect(type("https://vimeo.com/123")).toBe("video");
  });

  it("detects forums", () => {
    expect(type("https://www.reddit.com/r/HVAC/comments/x/best_software/")).toBe("forum");
    expect(type("https://www.quora.com/What-is-the-best-HVAC-software")).toBe("forum");
    expect(type("https://community.example.com/t/jobber-vs-housecall/42")).toBe("forum");
    expect(type("https://example.com/forums/software-talk")).toBe("forum");
  });

  it("detects review sites, including country domains", () => {
    expect(type("https://www.g2.com/articles/best-hvac-software")).toBe("review_site");
    expect(type("https://www.capterra.co.uk/directory/30019/field-service/software")).toBe("review_site");
    expect(type("https://www.softwareadvice.com/field-service/")).toBe("review_site");
  });

  it("detects vendor pages, including vendor-owned 'best X' posts, and names the owner", () => {
    const c = classifyCitation({ url: "https://getjobber.com/academy/best-hvac-crm/" }, BRANDS);
    expect(c).toMatchObject({ pageType: "vendor_page", owner: "Jobber", domain: "getjobber.com" });
    expect(type("https://pro.housecallpro.com/pricing")).toBe("vendor_page");
  });

  it("detects listicles on independent sites from the URL or title", () => {
    expect(type("https://smallcrewhq.com/best-cleaning-business-software")).toBe("listicle");
    expect(type("https://greenmargins.example/top-10-lawn-care-apps")).toBe("listicle");
    expect(type("https://example.com/jobber-alternatives")).toBe("listicle");
    expect(type("https://example.com/post/123", "Housecall Pro vs Jobber: which is better?")).toBe("listicle");
  });

  it("falls back to other", () => {
    expect(type("https://www.bls.gov/ooh/building-and-grounds-cleaning/pest-control-workers.htm")).toBe("other");
    expect(type("not a url")).toBe("other");
  });

  it("uses the title as the domain for Gemini grounding redirects", () => {
    const url = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc";
    expect(domainOf(url, "capterra.com")).toBe("capterra.com");
    expect(classifyCitation({ url, title: "getjobber.com" }, BRANDS)).toMatchObject({ pageType: "vendor_page", owner: "Jobber" });
    expect(domainOf(url, "Some page title")).toBe("vertexaisearch.cloud.google.com");
  });
});
