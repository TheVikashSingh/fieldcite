// Gaps view data (SPEC F-2): cited pages whose citing answers name competitors but not the
// target brand. Built only from stored answers and citations; nothing is fetched or inferred.

import type { EngineId } from "../engines/types";
import type { PageType } from "../extract/classify";
import type { CallRecord } from "../scan/run";

/** Points at one stored answer (an entry in the report's `calls`) and, optionally, one of its citations. */
export interface EvidenceRef {
  /** Short label shown in reports, e.g. "A3". Matches the label in the answers section. */
  answerId: string;
  /** Index into the report's `calls` array. */
  callIndex: number;
  engine: EngineId;
  questionIndex: number;
  run: number;
  /** Index into that answer's `citations`, when the evidence is a citation. */
  citationIndex?: number;
  url?: string;
}

export interface GapPage {
  url: string;
  domain: string;
  title?: string;
  pageType: PageType;
  owner?: string;
  /** Answers citing this page (each answer counted once). */
  citedIn: number;
  /** Answers received in the scan. */
  answers: number;
  /** Citing answers that name at least one competitor and not the target brand. */
  gapAnswers: number;
  /** Citing answers that do name the target brand. */
  targetAnswers: number;
  /** Engines behind the gap answers. */
  engines: EngineId[];
  /** Competitors named in the gap answers. */
  competitors: string[];
  /** One ref per gap answer, pointing at the citation of this page. */
  evidence: EvidenceRef[];
}

export const answerId = (callIndex: number) => `A${callIndex + 1}`;

export function evidenceRef(calls: CallRecord[], callIndex: number, citationIndex?: number): EvidenceRef {
  const c = calls[callIndex];
  const ref: EvidenceRef = { answerId: answerId(callIndex), callIndex, engine: c.engine, questionIndex: c.questionIndex, run: c.run };
  if (citationIndex !== undefined) {
    ref.citationIndex = citationIndex;
    ref.url = c.citations[citationIndex].url;
  }
  return ref;
}

/** Answers (ok calls) that name a competitor but not the target. */
export function isGapAnswer(call: CallRecord, target: string): boolean {
  return call.status === "ok" && !call.mentions.some((m) => m.brand === target) && call.mentions.some((m) => m.brand !== target);
}

/**
 * Lists gap pages, strongest first: most gap answers, then most engines, then most competitors.
 * The target's own pages are never gaps.
 */
export function findGaps(calls: CallRecord[], target: string): GapPage[] {
  const answers = calls.filter((c) => c.status === "ok").length;
  const pages = new Map<string, GapPage & { engineSet: Set<EngineId>; competitorSet: Set<string> }>();

  calls.forEach((call, callIndex) => {
    if (call.status !== "ok") return;
    const namesTarget = call.mentions.some((m) => m.brand === target);
    const gap = isGapAnswer(call, target);
    const seen = new Set<string>();
    call.citations.forEach((cite, citationIndex) => {
      if (seen.has(cite.url) || cite.owner === target) return;
      seen.add(cite.url);
      const page =
        pages.get(cite.url) ??
        {
          url: cite.url,
          domain: cite.domain,
          title: cite.title,
          pageType: cite.pageType,
          owner: cite.owner,
          citedIn: 0,
          answers,
          gapAnswers: 0,
          targetAnswers: 0,
          engines: [],
          competitors: [],
          evidence: [],
          engineSet: new Set<EngineId>(),
          competitorSet: new Set<string>(),
        };
      page.citedIn++;
      if (namesTarget) page.targetAnswers++;
      if (gap) {
        page.gapAnswers++;
        page.engineSet.add(call.engine);
        for (const m of call.mentions) page.competitorSet.add(m.brand);
        page.evidence.push(evidenceRef(calls, callIndex, citationIndex));
      }
      pages.set(cite.url, page);
    });
  });

  return [...pages.values()]
    .filter((p) => p.gapAnswers > 0)
    .map(({ engineSet, competitorSet, ...p }) => ({ ...p, engines: [...engineSet].sort(), competitors: [...competitorSet].sort() }))
    .sort(
      (a, b) =>
        b.gapAnswers - a.gapAnswers ||
        b.engines.length - a.engines.length ||
        b.competitors.length - a.competitors.length ||
        a.domain.localeCompare(b.domain) ||
        a.url.localeCompare(b.url),
    );
}
