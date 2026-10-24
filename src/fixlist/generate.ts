// Fix-list generator (SPEC F-3): 5 to 15 ranked actions built from the gaps evidence and the
// field-service templates (M-4). Ranking is by evidence strength only. Every action carries refs
// to the stored answers and citations behind it, and its "why" sentence is built from counts of
// that evidence, so nothing is claimed that the scan didn't record.

import { MAX_FIX_LIST_OUTPUT_TOKENS } from "../engines/guard";
import type { Country, EngineId } from "../engines/types";
import type { CallRecord } from "../scan/run";
import { evidenceRef, isGapAnswer, type EvidenceRef, type GapPage } from "./gaps";
import { FIX_KIND_ORDER, FIX_TEMPLATES, type FixKind } from "./templates";

export const MIN_FIXES = 5;
export const MAX_FIXES = 15;

export interface FixAction {
  rank: number;
  /** Stable id, e.g. "get_listed:https://…". */
  id: string;
  kind: FixKind;
  title: string;
  detail: string;
  /** The evidence in one sentence, built from counts only. */
  why: string;
  /** The cited pages the action is about (empty for question-level actions). */
  pages: { url: string; domain: string; title?: string }[];
  questionIndex?: number;
  strength: {
    /** answers × 3 + engines × 2 + competitors. */
    score: number;
    answers: number;
    engines: EngineId[];
    competitors: string[];
  };
  /** Never empty. */
  evidence: EvidenceRef[];
}

export interface FixListInput {
  calls: CallRecord[];
  gaps: GapPage[];
  target: string;
  trade: string;
  country: Country;
  questions: string[];
}

type Candidate = Omit<FixAction, "rank">;

const KIND_FOR_PAGE: Record<GapPage["pageType"], FixKind> = {
  listicle: "get_listed",
  review_site: "review_profile",
  forum: "forum_answer",
  video: "video_review",
  vendor_page: "comparison_page",
  other: "outreach",
};

const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pageLabel = (p: { title?: string; domain: string }) => (p.title && p.title !== p.domain ? `"${p.title}" (${p.domain})` : p.domain);

function strengthOf(calls: CallRecord[], evidence: EvidenceRef[], target: string): FixAction["strength"] {
  const answerIdx = [...new Set(evidence.map((e) => e.callIndex))];
  const engines = [...new Set(answerIdx.map((i) => calls[i].engine))].sort();
  const competitors = [...new Set(answerIdx.flatMap((i) => calls[i].mentions.map((m) => m.brand)))].filter((b) => b !== target).sort();
  return { score: answerIdx.length * 3 + engines.length * 2 + competitors.length, answers: answerIdx.length, engines, competitors };
}

/** One action about a group of gap pages (one page, or all pages on one review site, or all competitor-owned pages). */
function pageCandidate(input: FixListInput, kind: FixKind, pages: GapPage[]): Candidate {
  const { calls, target } = input;
  const urls = new Set(pages.map((p) => p.url));
  const evidence = pages.flatMap((p) => p.evidence);
  const strength = strengthOf(calls, evidence, target);
  const okCalls = calls.filter((c) => c.status === "ok");
  const citing = okCalls.filter((c) => c.citations.some((x) => urls.has(x.url))).length;
  const first = pages[0];
  const owners = [...new Set(pages.map((p) => p.owner).filter((o): o is string => !!o))].sort();
  const text = FIX_TEMPLATES[kind]({
    target,
    trade: input.trade,
    country: input.country,
    page: pageLabel(first),
    domain: first.domain,
    competitors: strength.competitors,
    owners,
  });
  const subject =
    kind === "comparison_page"
      ? `Competitor-owned pages (${list(owners)}) are cited`
      : pages.length > 1
        ? `${plural(pages.length, "page")} on ${first.domain} are cited`
        : "This page is cited";
  const why =
    `${subject} in ${citing} of ${okCalls.length} answers; ${strength.answers} of them (${strength.engines.join(", ")}) ` +
    `name ${list(strength.competitors)} but not ${target}.`;
  const id = kind === "comparison_page" ? "comparison_page" : kind === "review_profile" ? `review_profile:${first.domain}` : `${kind}:${first.url}`;
  return { id, kind, ...text, why, pages: pages.map((p) => ({ url: p.url, domain: p.domain, title: p.title })), strength, evidence };
}

/** Question-level actions, used only to reach MIN_FIXES. Evidence: the answers to that question that leave out the target. */
function questionCandidates(input: FixListInput): Candidate[] {
  const { calls, target } = input;
  return input.questions.flatMap((question, questionIndex) => {
    const answers = calls.map((c, i) => ({ c, i })).filter(({ c }) => c.status === "ok" && c.questionIndex === questionIndex);
    const gap = answers.filter(({ c }) => isGapAnswer(c, target));
    if (gap.length === 0) return [];
    const evidence = gap.map(({ i }) => evidenceRef(calls, i));
    const strength = strengthOf(calls, evidence, target);
    const text = FIX_TEMPLATES.answer_page({ target, trade: input.trade, country: input.country, question });
    const why = `${target} is not named in ${gap.length} of ${answers.length} answers to this question (${strength.engines.join(", ")}); they name ${list(strength.competitors)}.`;
    return [{ id: `answer_page:${questionIndex}`, kind: "answer_page" as const, ...text, why, pages: [], questionIndex, strength, evidence }];
  });
}

/** A comparison page backed by every gap answer, when no competitor-owned page was cited. Used only to reach MIN_FIXES. */
function fallbackComparison(input: FixListInput): Candidate | null {
  const { calls, target } = input;
  const gap = calls.map((c, i) => ({ c, i })).filter(({ c }) => isGapAnswer(c, target));
  if (gap.length === 0) return null;
  const evidence = gap.map(({ i }) => evidenceRef(calls, i));
  const strength = strengthOf(calls, evidence, target);
  const ok = calls.filter((c) => c.status === "ok").length;
  const text = FIX_TEMPLATES.comparison_page({ target, trade: input.trade, country: input.country });
  const why = `${target} is not named in ${gap.length} of ${ok} answers (${strength.engines.join(", ")}); they name ${list(strength.competitors)}.`;
  return { id: "comparison_page", kind: "comparison_page", ...text, why, pages: [], strength, evidence };
}

const byStrength = (a: Candidate, b: Candidate) =>
  b.strength.score - a.strength.score ||
  b.strength.answers - a.strength.answers ||
  FIX_KIND_ORDER.indexOf(a.kind) - FIX_KIND_ORDER.indexOf(b.kind) ||
  a.id.localeCompare(b.id);

/**
 * Builds the ranked fix list. Page-based actions come first, ranked by evidence strength; if
 * there are fewer than 5, question-level actions fill the list, still only where answers back
 * them. If the scan has too little evidence for 5, the list is shorter rather than padded.
 */
export function generateFixList(input: FixListInput): FixAction[] {
  const competitorPages = input.gaps.filter((g) => g.pageType === "vendor_page");
  const reviewByDomain = new Map<string, GapPage[]>();
  const candidates: Candidate[] = [];
  for (const g of input.gaps) {
    const kind = KIND_FOR_PAGE[g.pageType];
    if (kind === "comparison_page") continue;
    if (kind === "review_profile") reviewByDomain.set(g.domain, [...(reviewByDomain.get(g.domain) ?? []), g]);
    else candidates.push(pageCandidate(input, kind, [g]));
  }
  for (const pages of reviewByDomain.values()) candidates.push(pageCandidate(input, "review_profile", pages));
  if (competitorPages.length) candidates.push(pageCandidate(input, "comparison_page", competitorPages));
  candidates.sort(byStrength);

  if (candidates.length < MIN_FIXES) {
    const fillers = questionCandidates(input);
    if (!competitorPages.length) {
      const fallback = fallbackComparison(input);
      if (fallback) fillers.push(fallback);
    }
    candidates.push(...fillers.sort(byStrength).slice(0, MIN_FIXES - candidates.length));
  }

  return candidates
    .filter((c) => c.evidence.length > 0)
    .slice(0, MAX_FIXES)
    .map((c, i) => ({ rank: i + 1, ...c }));
}

/**
 * Optional LLM rewording of the template text (F-3: "a cheap LLM"). Implementations must make
 * at most one call through the engine adapter path, so it is costed and breaker-checked
 * (CS-7, CS-9), with `maxOutputTokens` as the hard cap (CS-6). None is wired up yet.
 */
export interface FixListRewriter {
  reword(input: { actions: { id: string; title: string; detail: string }[]; maxOutputTokens: number }): Promise<{ id: string; title: string; detail: string }[]>;
}

/**
 * Applies a rewriter to the title and detail only. Rank, evidence and the "why" sentence are
 * never taken from the model, so rewording can't add claims or drop evidence. Any failure keeps
 * the template text.
 */
export async function rewordFixList(actions: FixAction[], rewriter: FixListRewriter): Promise<FixAction[]> {
  let reworded: { id: string; title: string; detail: string }[];
  try {
    reworded = await rewriter.reword({
      actions: actions.map(({ id, title, detail }) => ({ id, title, detail })),
      maxOutputTokens: MAX_FIX_LIST_OUTPUT_TOKENS,
    });
  } catch {
    return actions;
  }
  const byId = new Map(reworded.map((r) => [r.id, r]));
  return actions.map((a) => {
    const r = byId.get(a.id);
    const title = r?.title?.trim();
    const detail = r?.detail?.trim();
    return { ...a, title: title || a.title, detail: detail || a.detail };
  });
}
