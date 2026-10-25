// Categories offered on the free-scan form. Imported rather than read from disk so the built app
// has them. Add a category here after adding data/categories/<slug>.json.

import hvac from "../../data/categories/hvac.json";
import pestControl from "../../data/categories/pest-control.json";
import type { Category } from "../scan/plan";

export const FREE_SCAN_CATEGORIES: readonly Category[] = [pestControl as Category, hvac as Category];

export function findCategory(slug: string): Category | null {
  return FREE_SCAN_CATEGORIES.find((c) => c.slug === slug) ?? null;
}

/** What the form needs: public names only. */
export const categoryOptions = () =>
  FREE_SCAN_CATEGORIES.map((c) => ({ slug: c.slug, name: c.name, brands: c.brands.map((b) => b.name) }));
