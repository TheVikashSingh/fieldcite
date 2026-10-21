// Brand extraction (SPEC §8): an alias list per brand first, with an optional cheap-model
// fallback behind an interface. Every mention keeps the matching text so a wrong match is visible.

export interface Brand {
  name: string;
  domain?: string;
  aliases?: string[];
}

export interface BrandMention {
  brand: string;
  /** 1-based order of first appearance in the answer. */
  position: number;
  /** The exact text that matched. */
  matched: string;
  /** Surrounding answer text, shown on hover in reports. */
  snippet: string;
  source: "alias" | "model";
}

export interface BrandExtractor {
  extract(text: string, brands: Brand[]): Promise<BrandMention[]>;
}

/**
 * A cheap-model extractor (e.g. a nano model with max 400 output tokens, CS-6) that returns
 * names of known brands the alias list missed. Implementations must call engines through the
 * adapter path so costs are logged (CS-9).
 */
export interface ModelBrandExtractor {
  findBrands(text: string, brands: Brand[]): Promise<string[]>;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function termsFor(brand: Brand): string[] {
  const terms = new Set<string>([brand.name, ...(brand.aliases ?? [])]);
  if (brand.domain) terms.add(brand.domain.replace(/^www\./, ""));
  return [...terms].filter((t) => t.trim().length > 1);
}

function snippetAround(text: string, index: number, length: number, radius = 60): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** Finds the first match of any term, on word boundaries, ignoring case. */
function firstMatch(text: string, terms: string[]): { index: number; matched: string } | null {
  let best: { index: number; matched: string } | null = null;
  for (const term of terms) {
    // Letters/digits may not touch the match, so "Jobber" does not match "Jobbers".
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term.trim()).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");
    const m = re.exec(text);
    if (m && (!best || m.index < best.index)) best = { index: m.index, matched: m[0] };
  }
  return best;
}

export function extractBrandsByAlias(text: string, brands: Brand[]): BrandMention[] {
  const found: { brand: string; index: number; matched: string }[] = [];
  for (const brand of brands) {
    const m = firstMatch(text, termsFor(brand));
    if (m) found.push({ brand: brand.name, ...m });
  }
  found.sort((a, b) => a.index - b.index);
  return found.map((f, i) => ({
    brand: f.brand,
    position: i + 1,
    matched: f.matched,
    snippet: snippetAround(text, f.index, f.matched.length),
    source: "alias",
  }));
}

export class AliasBrandExtractor implements BrandExtractor {
  async extract(text: string, brands: Brand[]): Promise<BrandMention[]> {
    return extractBrandsByAlias(text, brands);
  }
}

/**
 * Alias list first. The model is only asked when the alias list missed at least one known
 * brand, and only brands from the known list are accepted from it (no invented names).
 */
export class FallbackBrandExtractor implements BrandExtractor {
  constructor(private readonly model: ModelBrandExtractor | null) {}

  async extract(text: string, brands: Brand[]): Promise<BrandMention[]> {
    const mentions = extractBrandsByAlias(text, brands);
    if (!this.model || !text.trim()) return mentions;
    const missed = brands.filter((b) => !mentions.some((m) => m.brand === b.name));
    if (missed.length === 0) return mentions;
    const names = await this.model.findBrands(text, missed);
    const byName = new Map(missed.map((b) => [b.name.toLowerCase(), b]));
    let position = mentions.length;
    for (const name of names) {
      const brand = byName.get(name.trim().toLowerCase());
      if (!brand) continue;
      byName.delete(name.trim().toLowerCase());
      mentions.push({ brand: brand.name, position: ++position, matched: name, snippet: snippetAround(text, 0, 0, 120), source: "model" });
    }
    return mentions;
  }
}
