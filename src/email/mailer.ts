// Outgoing email: magic links (F-9) and free-scan verification (F-1). Resend in production; in
// development without a key, links are printed to the server log instead of sent.

import type { Env } from "../engines/guard";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

export class MailerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailerConfigError";
  }
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export const RESEND_URL = "https://api.resend.com/emails";

/** Resend's REST API (https://resend.com/docs/api-reference/emails/send-email). The key stays server-side (CS-12). */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly timeoutMs = 10_000,
  ) {}

  async send(email: Email): Promise<void> {
    const res = await this.fetchFn(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [email.to], subject: email.subject, text: email.text, ...(email.html ? { html: email.html } : {}) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Resend returned HTTP ${res.status}`);
  }
}

/** Development only: prints the email, link included, to the server log. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly log: (line: string) => void = (line) => console.log(line)) {}

  async send(email: Email): Promise<void> {
    this.log(`[email to ${email.to}] ${email.subject}\n${email.text}`);
  }
}

/** Tests: keeps sent emails in memory. */
export class MemoryMailer implements Mailer {
  readonly sent: Email[] = [];

  async send(email: Email): Promise<void> {
    this.sent.push(email);
  }

  /** The first link in the most recent email to `to`. */
  lastLinkTo(to: string): string | null {
    const email = [...this.sent].reverse().find((e) => e.to === to);
    return email?.text.match(/https?:\/\/\S+/)?.[0] ?? null;
  }
}

export function mailerFromEnv(env: Env = process.env): Mailer {
  if (env.RESEND_API_KEY) {
    if (!env.EMAIL_FROM) throw new MailerConfigError("EMAIL_FROM must be set when RESEND_API_KEY is set.");
    return new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  if (env.NODE_ENV === "production") throw new MailerConfigError("RESEND_API_KEY is not set: production can't send email.");
  return new ConsoleMailer();
}
