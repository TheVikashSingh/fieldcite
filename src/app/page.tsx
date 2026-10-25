import Link from "next/link";
import { categoryOptions } from "../freescan/categories";
import { turnstileSiteKey } from "../freescan/server";
import { FreeScanForm } from "./FreeScanForm";

// The Turnstile site key comes from the environment at request time.
export const dynamic = "force-dynamic";

const CONFIRM_ERRORS: Record<string, string> = {
  repeat: "This email address or company domain already had a free scan in the last 30 days.",
  paused: "Free scans are paused right now. Please try again tomorrow.",
  busy: "You already have a scan running. Wait for its report, then try again.",
  not_found: "That confirmation link isn't valid any more. Please request a new free scan.",
};

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { error } = await searchParams;
  return (
    <main className="site-narrow">
      <h1>Does ChatGPT recommend your field-service software?</h1>
      <p>
        Buyers ask AI assistants which scheduling, quoting and invoicing app to use. FieldCite shows who ChatGPT, Perplexity and Gemini recommend instead of
        you, the pages those answers come from, and a ranked list of fixes.
      </p>
      <p>
        <Link href="/r/demo">See a sample report</Link> (synthetic data for pest control software in the US).
      </p>

      <h2 id="free-scan">Run a free scan</h2>
      {error && CONFIRM_ERRORS[error] ? (
        <p role="alert" className="site-error">
          {CONFIRM_ERRORS[error]}
        </p>
      ) : null}
      <FreeScanForm categories={categoryOptions()} turnstileSiteKey={turnstileSiteKey()} />

      <p className="site-hint">
        Results come from each engine&apos;s official API with web search enabled. This approximates, but does not exactly match, what people see in the
        consumer apps. AI answers vary between runs. <Link href="/login">Sign in</Link>
      </p>
    </main>
  );
}
