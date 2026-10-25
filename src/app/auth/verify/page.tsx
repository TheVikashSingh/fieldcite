import type { Metadata } from "next";

export const metadata: Metadata = { title: "Continue · FieldCite", robots: { index: false } };

// Email scanners open links in advance. Opening this page changes nothing: the token is only
// used when the person presses the button (a POST to /auth/confirm).
export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { token = "" } = await searchParams;
  return (
    <main className="site-narrow">
      <h1>One more step</h1>
      <form method="post" action="/auth/confirm" className="site-form">
        <input type="hidden" name="token" value={token} />
        <button type="submit">Continue</button>
      </form>
    </main>
  );
}
