// OpenAI Responses API + web_search tool, with the buyer's country as user location (SPEC §8).

import { asArr, asNum, asObj, asStr, dedupeCitations, defaultFetch, guardedCall, requireKey, type AdapterDeps } from "./base";
import { postJson } from "./http";
import { costUsd, DEFAULT_MODELS, getPrice } from "./pricing";
import { COUNTRY_ISO, type AskOptions, type Citation, type EngineAdapter, type EngineAnswer } from "./types";

export const OPENAI_URL = "https://api.openai.com/v1/responses";

export function buildOpenAIRequest(model: string, question: string, opts: AskOptions) {
  return {
    model,
    input: question,
    tools: [{ type: "web_search", user_location: { type: "approximate", country: COUNTRY_ISO[opts.country] } }],
    // CS-6. For gpt-5 models this cap includes reasoning tokens, so keep reasoning effort low.
    max_output_tokens: opts.maxOutputTokens,
    reasoning: { effort: "low" },
    store: false,
  };
}

export function parseOpenAIResponse(model: string, raw: unknown): Omit<EngineAnswer, "attempts"> {
  const body = asObj(raw);
  const output = asArr(body.output).map(asObj);
  const texts: string[] = [];
  const citations: Citation[] = [];
  let searchCalls = 0;
  for (const item of output) {
    if (item.type === "web_search_call") searchCalls++;
    if (item.type !== "message") continue;
    for (const part of asArr(item.content).map(asObj)) {
      if (part.type !== "output_text") continue;
      texts.push(asStr(part.text) ?? "");
      for (const a of asArr(part.annotations).map(asObj)) {
        const url = asStr(a.url);
        if (a.type === "url_citation" && url) citations.push({ url, title: asStr(a.title) });
      }
    }
  }
  const u = asObj(body.usage);
  const usage = { inputTokens: asNum(u.input_tokens), outputTokens: asNum(u.output_tokens), searchCalls };
  return {
    text: texts.join("\n").trim(),
    citations: dedupeCitations(citations),
    usage,
    costUsd: costUsd(model, usage),
    model,
    raw,
  };
}

export function createOpenAIAdapter(deps: AdapterDeps): EngineAdapter {
  const model = deps.model ?? DEFAULT_MODELS.openai;
  getPrice(model); // CS-9: refuse models without a price before any call.
  const apiKey = requireKey(deps, "OPENAI_API_KEY");
  const fetchFn = defaultFetch(deps);
  return {
    id: "openai",
    model,
    async ask(question, opts) {
      const { result, attempts } = await guardedCall(deps, opts, () =>
        postJson(fetchFn, OPENAI_URL, { authorization: `Bearer ${apiKey}` }, buildOpenAIRequest(model, question, opts), opts.timeoutMs),
      );
      return { ...parseOpenAIResponse(model, result), attempts };
    },
  };
}
