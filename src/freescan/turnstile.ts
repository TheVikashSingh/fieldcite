// Cloudflare Turnstile check for the free-scan form (CS-11). Fails closed: any error means "not
// verified". The secret key stays on the server (CS-12).

import type { Env } from "../engines/guard";

export interface TurnstileVerifier {
  verify(token: string, ip: string | null): Promise<boolean>;
}

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export class CloudflareTurnstile implements TurnstileVerifier {
  constructor(
    private readonly secret: string,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly timeoutMs = 10_000,
  ) {}

  async verify(token: string, ip: string | null): Promise<boolean> {
    if (!token || token.length > 2048) return false;
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (ip) body.set("remoteip", ip);
    try {
      const res = await this.fetchFn(SITEVERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return false;
      const data = (await res.json()) as { success?: unknown };
      return data.success === true;
    } catch {
      return false;
    }
  }
}

/** Development without Turnstile keys: the widget isn't shown and every check passes. */
export const SKIP_TURNSTILE: TurnstileVerifier = { verify: async () => true };

export class TurnstileConfigError extends Error {
  constructor() {
    super("TURNSTILE_SECRET_KEY is not set: production refuses free scans without bot protection (CS-11).");
    this.name = "TurnstileConfigError";
  }
}

export function turnstileFromEnv(env: Env = process.env): TurnstileVerifier {
  if (env.TURNSTILE_SECRET_KEY) return new CloudflareTurnstile(env.TURNSTILE_SECRET_KEY);
  if (env.NODE_ENV === "production") throw new TurnstileConfigError();
  return SKIP_TURNSTILE;
}
