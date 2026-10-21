// Perplexity Sonar (chat completions). Country goes in the question and in user_location (SPEC §8).

import { asArr, asNum, asObj, asStr, dedupeCitations, defaultFetch, guardedCall, requireKey, withCountry, type AdapterDeps } from "./base";
import { postJson } from "./http";
import { costUsd, DEFAULT_MODELS, getPrice } from "./pricing";
import { COUNTRY_ISO, type AskOptions, type Citation, type EngineAdapter, type EngineAnswer } from "./types";

export const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";

export function buildPerplexityRequest(model: string, question: string, opts: AskOptions) {
  return {
    model,
    messages: [{ role: "user", content: withCountry(question, opts.country) }],
    max_tokens: opts.maxOutputTokens, // CS-6
    web_search_options: { user_location: { country: COUNTRY_ISO[opts.country] } },
  };
}

export function parsePerplexityResponse(model: string, raw: unknown): Omit<EngineAnswer, "attempts"> {
  const body = asObj(raw);
  const message = asObj(asObj(asArr(body.choices)[0]).message);
  const citations: Citation[] = [];
  for (const r of asArr(body.search_results).map(asObj)) {
    const url = asStr(r.url);
    if (url) citations.push({ url, title: asStr(r.title) });
  }
  // Older responses only carry a plain `citations` URL list.
  for (const c of asArr(body.citations)) {
    const url = asStr(c);
    if (url) citations.push({ url });
  }
  const u = asObj(body.usage);
  // Every Sonar request searches; the request fee is in the pricing table.
  const usage = { inputTokens: asNum(u.prompt_tokens), outputTokens: asNum(u.completion_tokens), searchCalls: 1 };
  return {
    text: (asStr(message.content) ?? "").trim(),
    citations: dedupeCitations(citations),
    usage,
    costUsd: costUsd(model, usage),
    model,
    raw,
  };
}

export function createPerplexityAdapter(deps: AdapterDeps): EngineAdapter {
  const model = deps.model ?? DEFAULT_MODELS.perplexity;
  getPrice(model);
  const apiKey = requireKey(deps, "PERPLEXITY_API_KEY");
  const fetchFn = defaultFetch(deps);
  return {
    id: "perplexity",
    model,
    async ask(question, opts) {
      const { result, attempts } = await guardedCall(deps, opts, () =>
        postJson(fetchFn, PERPLEXITY_URL, { authorization: `Bearer ${apiKey}` }, buildPerplexityRequest(model, question, opts), opts.timeoutMs),
      );
      return { ...parsePerplexityResponse(model, result), attempts };
    },
  };
}
