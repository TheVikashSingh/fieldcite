import type { Metadata } from "next";
import { safeNextPath } from "../../auth/magic-link";
import { requestLogin } from "./actions";

export const metadata: Metadata = { title: "Sign in · FieldCite", robots: { index: false } };

const ERRORS: Record<string, string> = {
  email: "Enter a valid email address.",
  expired: "That link has expired or was already used. Request a new one.",
  unavailable: "Sign-in isn't available right now. Please try again later.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  return (
    <main className="site-narrow">
      <h1>Sign in</h1>
      {params.sent ? (
        <p role="status">Check your inbox. If the address is valid, we sent a sign-in link that works once and expires in 15 minutes.</p>
      ) : (
        <form action={requestLogin} className="site-form">
          {params.error && ERRORS[params.error] ? (
            <p role="alert" className="site-error">
              {ERRORS[params.error]}
            </p>
          ) : null}
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
          <input type="hidden" name="next" value={next} />
          <button type="submit">Email me a sign-in link</button>
          <p className="site-hint">No password. We email you a one-time link.</p>
        </form>
      )}
    </main>
  );
}
