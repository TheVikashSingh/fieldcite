import { describe, expect, it, vi } from "vitest";
import { AliasBrandExtractor, extractBrandsByAlias, FallbackBrandExtractor, type Brand, type ModelBrandExtractor } from "./brands";

const BRANDS: Brand[] = [
  { name: "Jobber", domain: "getjobber.com" },
  { name: "Housecall Pro", domain: "housecallpro.com", aliases: ["HousecallPro"] },
  { name: "ServiceTitan", aliases: ["Service Titan"] },
  { name: "PestPac", aliases: ["PestPac by WorkWave"] },
  { name: "ServiceM8" },
];

describe("alias brand extraction", () => {
  it("orders brands by first appearance", () => {
    const m = extractBrandsByAlias("Try ServiceTitan, then Jobber. Housecall Pro is fine too.", BRANDS);
    expect(m.map((x) => [x.brand, x.position])).toEqual([
      ["ServiceTitan", 1],
      ["Jobber", 2],
      ["Housecall Pro", 3],
    ]);
  });

  it("matches aliases, case and spacing variants", () => {
    const m = extractBrandsByAlias("We like housecallpro and SERVICE   TITAN.", BRANDS);
    expect(m.map((x) => x.brand)).toEqual(["Housecall Pro", "ServiceTitan"]);
    expect(m[0].matched).toBe("housecallpro");
  });

  it("matches a brand by its domain", () => {
    expect(extractBrandsByAlias("See getjobber.com for pricing", BRANDS).map((x) => x.brand)).toEqual(["Jobber"]);
  });

  it("respects word boundaries", () => {
    expect(extractBrandsByAlias("Jobbers and ServiceM80 are not brands", BRANDS)).toEqual([]);
    expect(extractBrandsByAlias("Jobber's app", BRANDS).map((x) => x.brand)).toEqual(["Jobber"]);
  });

  it("counts a brand once and keeps a snippet of the matching text", () => {
    const m = extractBrandsByAlias("Jobber is good. Jobber is cheap.", BRANDS);
    expect(m).toHaveLength(1);
    expect(m[0].snippet).toContain("Jobber is good");
    expect(m[0].source).toBe("alias");
  });

  it("handles markdown bold and regex characters in names", () => {
    const brands: Brand[] = [{ name: "Field.Pro (beta)" }, { name: "PestPac" }];
    const m = extractBrandsByAlias("1. **PestPac** and Field.Pro (beta)", brands);
    expect(m.map((x) => x.brand)).toEqual(["PestPac", "Field.Pro (beta)"]);
  });

  it("returns nothing for empty text", async () => {
    expect(await new AliasBrandExtractor().extract("", BRANDS)).toEqual([]);
  });
});

describe("cheap-model fallback", () => {
  it("asks the model only about brands the alias list missed, and accepts only known brands", async () => {
    const model: ModelBrandExtractor = { findBrands: vi.fn(async () => ["ServiceM8", "Made Up Brand"]) };
    const m = await new FallbackBrandExtractor(model).extract("Jobber, and the Aussie one, Service M-8", BRANDS);
    expect(model.findBrands).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.arrayContaining([expect.objectContaining({ name: "Jobber" })]),
    );
    expect(m.map((x) => [x.brand, x.source, x.position])).toEqual([
      ["Jobber", "alias", 1],
      ["ServiceM8", "model", 2],
    ]);
  });

  it("does not call the model when every brand already matched", async () => {
    const model: ModelBrandExtractor = { findBrands: vi.fn(async () => []) };
    const one: Brand[] = [{ name: "Jobber" }];
    await new FallbackBrandExtractor(model).extract("Jobber", one);
    expect(model.findBrands).not.toHaveBeenCalled();
  });

  it("works with no model", async () => {
    const m = await new FallbackBrandExtractor(null).extract("Jobber", BRANDS);
    expect(m.map((x) => x.brand)).toEqual(["Jobber"]);
  });
});
