// Magic-link flow (SPEC F-9), shared with free-scan email verification (F-1, CS-11):
// request → email with a one-time link → confirm → verified user, account and session.

import type { Mailer } from "../email/mailer";
import type { AuthStore, ConsumedLink, LinkPurpose } from "./store";
import { hashToken, isToken, newToken } from "./tokens";

export const LINK_TTL_MINUTES = 15;
/** At most this many links per address per hour, whatever their purpose (stops inbox flooding). */
export const MAX_LINKS_PER_HOUR = 5;

export interface MagicLinkDeps {
  store: AuthStore;
  mailer: Mailer;
  /** The app's public origin, e.g. https://fieldcite.com. Links point at `${baseUrl}/auth/verify`. */
  baseUrl: string;
  now?: () => Date;
}

export type SendResult = "sent" | "rate_limited";

const EMAILS: Record<LinkPurpose, { subject: string; intro: string; action: string }> = {
  login: {
    subject: "Your FieldCite sign-in link",
    intro: "Use this link to sign in to FieldCite.",
    action: "Sign in",
  },
  free_scan: {
    subject: "Confirm your free FieldCite scan",
    intro: "Confirm your email to start your free scan. Your report will be ready a few minutes after you confirm.",
    action: "Confirm and start my scan",
  },
};

export function verifyUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/auth/verify?token=${token}`;
}

/**
 * Creates a one-time link and emails it. `email` must already be normalized. Callers should show
 * the same "check your inbox" message whatever this returns, so the page never reveals anything
 * about an address.
 */
export async function sendMagicLink(
  deps: MagicLinkDeps,
  input: { email: string; purpose: LinkPurpose; payload?: Record<string, unknown> },
): Promise<SendResult> {
  const now = (deps.now ?? (() => new Date()))();
  const recent = await deps.store.countLinksSince(input.email, new Date(now.getTime() - 60 * 60 * 1000));
  if (recent >= MAX_LINKS_PER_HOUR) return "rate_limited";

  const token = newToken();
  await deps.store.createLink({
    tokenHash: hashToken(token),
    email: input.email,
    purpose: input.purpose,
    payload: input.payload ?? {},
    expiresAt: new Date(now.getTime() + LINK_TTL_MINUTES * 60 * 1000),
    createdAt: now,
  });
  const url = verifyUrl(deps.baseUrl, token);
  const copy = EMAILS[input.purpose];
  await deps.mailer.send({
    to: input.email,
    subject: copy.subject,
    text: `${copy.intro}\n\n${copy.action}: ${url}\n\nThe link works once and expires in ${LINK_TTL_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
    html: `<p>${copy.intro}</p><p><a href="${url}">${copy.action}</a></p><p>The link works once and expires in ${LINK_TTL_MINUTES} minutes. If you didn't ask for it, ignore this email.</p>`,
  });
  return "sent";
}

export interface ConfirmedLink extends ConsumedLink {
  userId: string;
  accountId: string;
}

/**
 * Uses a link from an email: marks it used, creates or updates the verified user and their
 * account. Returns null for unknown, used or expired links (callers show one generic message).
 */
export async function confirmMagicLink(deps: Pick<MagicLinkDeps, "store" | "now">, token: string): Promise<ConfirmedLink | null> {
  if (!isToken(token)) return null;
  const now = (deps.now ?? (() => new Date()))();
  const link = await deps.store.consumeLink(hashToken(token), now);
  if (!link) return null;
  const userId = await deps.store.upsertVerifiedUser(link.email, now);
  const accountId = await deps.store.ensureAccount(userId, link.email);
  return { ...link, userId, accountId };
}

/** Only same-site paths are allowed as a post-login destination (no open redirects). */
export function safeNextPath(value: unknown, fallback = "/account"): string {
  return typeof value === "string" && /^\/(?![/\\])[^\s]*$/.test(value) ? value : fallback;
}
