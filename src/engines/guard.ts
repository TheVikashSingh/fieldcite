// Cost-safety guards shared by every engine call (SPEC §9).

/** Environment variables; a plain record so tests can pass partial envs. */
export type Env = Record<string, string | undefined>;

/** CS-5: at most 150 engine calls per scan. */
export const MAX_CALLS_PER_SCAN = 150;
/** CS-5: at most 60 s per call. */
export const MAX_TIMEOUT_MS = 60_000;
/** CS-5: at most 2 retries (3 attempts in total). */
export const MAX_RETRIES = 2;
/** CS-6: answer calls are capped at 1,200 output tokens. */
export const MAX_ANSWER_OUTPUT_TOKENS = 1_200;
/** CS-6: fix-list calls are capped at 1,500 output tokens. */
export const MAX_FIX_LIST_OUTPUT_TOKENS = 1_500;

export class ScansDisabledError extends Error {
  constructor() {
    super("Scans are disabled (SCANS_ENABLED=false). No engine calls will be made (CS-8).");
    this.name = "ScansDisabledError";
  }
}

export class CallLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallLimitError";
  }
}

/**
 * CS-8 kill switch. Read from the environment on every call (never cached), so flipping
 * SCANS_ENABLED=false stops new calls without a deploy. Anything other than "false"/"0"/"off"
 * counts as enabled.
 */
export function scansEnabled(env: Env = process.env): boolean {
  const v = (env.SCANS_ENABLED ?? "true").trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "off");
}

export function assertScansEnabled(env: Env = process.env): void {
  if (!scansEnabled(env)) throw new ScansDisabledError();
}

/** CS-5 / CS-6: reject call options above the hard limits instead of silently raising them. */
export function assertCallLimits(opts: { maxOutputTokens: number; timeoutMs: number }): void {
  const { maxOutputTokens, timeoutMs } = opts;
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > MAX_ANSWER_OUTPUT_TOKENS) {
    throw new CallLimitError(`maxOutputTokens must be an integer from 1 to ${MAX_ANSWER_OUTPUT_TOKENS} (CS-6); got ${maxOutputTokens}`);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new CallLimitError(`timeoutMs must be from 1 to ${MAX_TIMEOUT_MS} (CS-5); got ${timeoutMs}`);
  }
}

/** CS-5: a scan may plan at most 150 calls. */
export function assertScanCallBudget(calls: number): void {
  if (!Number.isInteger(calls) || calls < 1) throw new CallLimitError(`A scan must plan at least 1 call; got ${calls}`);
  if (calls > MAX_CALLS_PER_SCAN) {
    throw new CallLimitError(`This scan would make ${calls} engine calls; the limit is ${MAX_CALLS_PER_SCAN} per scan (CS-5).`);
  }
}
