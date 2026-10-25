// CS-12: no key, database URL or other env value reaches client code. Client components are
// the only code Next.js ships to the browser, so none may read the env or import server modules,
// and the server-only modules must say so. CI also builds the app with sentinel values and
// greps the browser bundle for them (scripts/check-client-bundle.sh).

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoReport } from "./demo-source";
import { ReportView } from "./ReportView";

const root = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

const files = sourceFiles(root).map((path) => ({ path: relative(root, path).replace(/\\/g, "/"), code: readFileSync(path, "utf8") }));
const isClient = (code: string) => /^\s*(\/\/[^\n]*\n\s*|\/\*[^]*?\*\/\s*)*["']use client["']/.test(code);
const SERVER_IMPORT =
  /from\s+["'](pg|node:[^"']+|server-only|next\/headers|[./]*(ledger|cost|engines|scan|auth|email|server|enrich|freescan|report\/(server|pg-source|demo-source))(\/[^"']*)?)["']/;

afterEach(() => vi.unstubAllEnvs());

describe("client boundary", () => {
  it("finds the source files", () => {
    expect(files.some((f) => f.path === "report/ReportView.tsx")).toBe(true);
  });

  it("client components never read the env or import server code", () => {
    for (const f of files.filter((x) => isClient(x.code))) {
      expect(f.code, f.path).not.toMatch(/process\.env|import\.meta\.env/);
      expect(f.code, f.path).not.toMatch(SERVER_IMPORT);
    }
  });

  it("the report page has no client components at all", () => {
    for (const f of files.filter((x) => x.path.startsWith("app/r/") || x.path.startsWith("report/"))) {
      expect(isClient(f.code), f.path).toBe(false);
    }
  });

  it("the only client component outside the report is the free-scan form", () => {
    expect(files.filter((f) => isClient(f.code)).map((f) => f.path)).toEqual(["app/FreeScanForm.tsx"]);
  });

  it("modules that touch the database or fixtures are marked server-only", () => {
    for (const path of ["report/pg-source.ts", "report/server.ts", "report/demo-source.ts"]) {
      expect(files.find((f) => f.path === path)?.code, path).toMatch(/^import "server-only";$/m);
    }
  });

  it("no env value appears in a rendered report", async () => {
    // Built at runtime so the secret scanner doesn't read them as keys.
    const names = ["OPENAI_API_KEY", "PERPLEXITY_API_KEY", "GEMINI_API_KEY", "DATABASE_URL"];
    const sentinels = Object.fromEntries(names.map((n) => [n, `not-a-secret-${n.toLowerCase().replace(/_/g, "-")}`]));
    for (const [k, v] of Object.entries(sentinels)) vi.stubEnv(k, v);
    const html = renderToStaticMarkup(<ReportView report={await buildDemoReport()} sample />);
    for (const [k, v] of Object.entries(sentinels)) {
      expect(html).not.toContain(v);
      expect(html).not.toContain(k);
    }
    expect(html).not.toContain("dry-run");
  });
});
