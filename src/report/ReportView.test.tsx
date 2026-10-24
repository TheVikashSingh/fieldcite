// Renders the report page from the fixture report and checks every F-2 / F-3 / §8 section.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { METHOD_NOTE, type ScanReport } from "../scan/report";
import { buildDemoReport } from "./demo-source";
import { ENGINE_LABELS, plainSnippet, ReportView } from "./ReportView";

let report: ScanReport;
let html: string;

/** The page's text with entities decoded, for comparing against plain strings. */
const decode = (s: string) =>
  s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const text = (s: string) => decode(s.replace(/<[^>]+>/g, ""));

beforeAll(async () => {
  report = await buildDemoReport();
  html = renderToStaticMarkup(<ReportView report={report} sample />);
});

describe("ReportView", () => {
  it("uses a report with every section populated", () => {
    expect(report.totals.ok).toBe(15);
    expect(report.targetBrand).toBe("Briostack");
    expect(report.gaps?.length).toBeGreaterThan(0);
    expect(report.fixList?.length).toBeGreaterThanOrEqual(5);
    expect(report.calls.every((c) => c.raw === undefined)).toBe(true);
  });

  it("shows share of voice per brand per engine as mentioned/answers", () => {
    const section = html.slice(html.indexOf('id="share-of-voice"'), html.indexOf('id="gaps"'));
    for (const row of report.shareOfVoice) {
      expect(section).toContain(`<th scope="row">${row.brand}</th>`);
      for (const e of report.engines) {
        const v = row.byEngine[e.id]!;
        expect(section).toContain(`aria-label="${row.brand}: ${v.mentioned}/${v.answers} ${ENGINE_LABELS[e.id]} answers"`);
      }
      expect(text(section)).toContain(`${row.mentioned}/${row.answers}`);
    }
    expect(section).toMatch(/<tr class="is-target"><th scope="row">Briostack<\/th>/);
  });

  it("lists every answer under its question, with brands in position order and a hover snippet", () => {
    const answers = html.slice(html.indexOf('id="answers"'));
    report.questions.forEach((q, i) => expect(text(answers)).toContain(`Q${i + 1}. ${q}`));
    report.calls.forEach((c, ci) => {
      const id = `A${ci + 1}`;
      expect(answers).toContain(`id="${id}"`);
      const end = answers.indexOf(`id="A${ci + 2}"`);
      const block = text(answers.slice(answers.indexOf(`id="${id}"`), end < 0 ? undefined : end));
      let at = 0;
      for (const m of c.mentions) {
        const next = block.indexOf(`${m.position} ${m.brand}`, at);
        expect(next, `${id} names ${m.brand} at ${m.position}`).toBeGreaterThanOrEqual(at);
        at = next;
        expect(block).toContain(plainSnippet(m.snippet));
      }
    });
    // The snippet is a tooltip tied to its chip, with the matched text marked.
    const m = report.calls[0].mentions[0];
    expect(answers).toContain('aria-describedby="A1-m1"');
    expect(answers).toMatch(new RegExp(`role="tooltip" id="A1-m1">[^]*?<mark>${m.matched}</mark>`));
  });

  it("lists every cited URL with its page type", () => {
    const section = html.slice(html.indexOf('id="cited-pages"'), html.indexOf('id="answers"'));
    const labels: Record<string, string> = { listicle: "Listicle", review_site: "Review site", forum: "Forum", vendor_page: "Vendor page", video: "Video", other: "Other" };
    for (const p of report.citedPages) {
      const at = section.indexOf(`href="${p.url.replace(/&/g, "&amp;")}"`);
      expect(at, p.url).toBeGreaterThan(0);
      expect(section.slice(at, section.indexOf("</p>", at))).toContain(`class="tag tag-${p.pageType}">${labels[p.pageType]}<`);
    }
  });

  it("shows the gaps view with links to the answers behind each page", () => {
    const section = html.slice(html.indexOf('id="gaps"'), html.indexOf('id="fix-list"'));
    expect(text(section)).toContain("Gaps: pages that cite competitors and not Briostack");
    for (const g of report.gaps!) {
      expect(section).toContain(`href="${g.url}"`);
      expect(text(section)).toContain(`${g.gapAnswers} without Briostack`);
      for (const e of g.evidence) expect(section).toContain(`href="#${e.answerId}"`);
    }
  });

  it("shows the ranked fix list with evidence links that resolve to answers on the page", () => {
    const section = html.slice(html.indexOf('id="fix-list"'), html.indexOf('id="cited-pages"'));
    const body = text(section);
    let at = 0;
    for (const a of report.fixList!) {
      const next = body.indexOf(`${a.rank} ${a.title}`, at);
      expect(next, `rank ${a.rank}`).toBeGreaterThanOrEqual(at);
      at = next;
      expect(body).toContain(a.why);
      for (const e of a.evidence) {
        expect(section).toContain(`href="#${e.answerId}"`);
        expect(html).toContain(`id="${e.answerId}"`);
      }
      for (const p of a.pages) expect(section).toContain(`href="${p.url}"`);
    }
  });

  it("shows the method and disclaimer box with the exact SPEC §8 wording", () => {
    const box = html.slice(html.indexOf('aria-labelledby="method-h"'), html.indexOf("</aside>"));
    expect(text(box)).toContain("Method and disclaimer");
    expect(text(box)).toContain(METHOD_NOTE);
    expect(METHOD_NOTE).toBe(
      "Results come from each engine's official API with web search enabled. This approximates, but does not exactly match, what people see in the consumer apps. AI answers vary between runs.",
    );
  });

  it("marks sample data, and only sample or dry-run data", () => {
    expect(text(html)).toContain("Sample data.");
    const real = renderToStaticMarkup(<ReportView report={{ ...report, dryRun: false }} />);
    expect(real).not.toContain("sample-banner");
  });

  it("keeps outbound links from sending the report URL as referrer", () => {
    const external = [...html.matchAll(/<a href="https?:[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(external.length).toBeGreaterThan(0);
    for (const a of external) expect(a).toContain('rel="noopener noreferrer nofollow"');
  });

  it("explains the missing gaps and fix list when no brand was set", () => {
    const out = text(renderToStaticMarkup(<ReportView report={{ ...report, targetBrand: null, gaps: null, fixList: null }} />));
    expect(out).toContain("No brand was set for this scan");
    expect(out).not.toContain("Fix list for");
  });
});
