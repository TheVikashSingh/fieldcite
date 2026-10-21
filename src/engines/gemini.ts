// Gemini generateContent + Grounding with Google Search. Country goes in the question (SPEC §8).

import { asArr, asNum, asObj, asStr, dedupeCitations, defaultFetch, guardedCall, requireKey, withCountry, type AdapterDeps } from "./base";
import { postJson } from "./http";
import { costUsd, DEFAULT_MODELS, getPrice } from "./pricing";
import { type AskOptions, type Citation, type EngineAdapter, type EngineAnswer } from "./types";

export const geminiUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

export function buildGeminiRequest(question: string, opts: AskOptions) {
  return {
    contents: [{ role: "user", parts: [{ text: withCountry(question, opts.country) }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      maxOutputTokens: opts.maxOutputTokens, // CS-6
      // Thinking tokens count against maxOutputTokens and are billed as output; turn them off.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
}

export function parseGeminiResponse(model: string, raw: unknown): Omit<EngineAnswer, "attempts"> {
  const body = asObj(raw);
  const candidate = asObj(asArr(body.candidates)[0]);
  const text = asArr(asObj(candidate.content).parts)
    .map((p) => asStr(asObj(p).text) ?? "")
    .join("")
    .trim();
  const grounding = asObj(candidate.groundingMetadata);
  const citations: Citation[] = [];
  // Grounding URIs are Google redirect links; the title holds the source domain.
  for (const chunk of asArr(grounding.groundingChunks).map(asObj)) {
    const web = asObj(chunk.web);
    const url = asStr(web.uri);
    if (url) citations.push({ url, title: asStr(web.title) });
  }
  const grounded = asArr(grounding.webSearchQueries).length > 0 || citations.length > 0;
  const u = asObj(body.usageMetadata);
  const usage = {
    inputTokens: asNum(u.promptTokenCount) + asNum(u.toolUsePromptTokenCount),
    outputTokens: asNum(u.candidatesTokenCount) + asNum(u.thoughtsTokenCount),
    // Gemini 2.5 bills per grounded prompt, not per query.
    searchCalls: grounded ? 1 : 0,
  };
  return { text, citations: dedupeCitations(citations), usage, costUsd: costUsd(model, usage), model, raw };
}

export function createGeminiAdapter(deps: AdapterDeps): EngineAdapter {
  const model = deps.model ?? DEFAULT_MODELS.gemini;
  getPrice(model);
  const apiKey = requireKey(deps, "GEMINI_API_KEY");
  const fetchFn = defaultFetch(deps);
  return {
    id: "gemini",
    model,
    async ask(question, opts) {
      const { result, attempts } = await guardedCall(deps, opts, () =>
        postJson(fetchFn, geminiUrl(model), { "x-goog-api-key": apiKey }, buildGeminiRequest(question, opts), opts.timeoutMs),
      );
      return { ...parseGeminiResponse(model, result), attempts };
    },
  };
}
