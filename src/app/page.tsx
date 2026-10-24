import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>FieldCite</h1>
      <p>
        Who do ChatGPT, Perplexity and Gemini recommend for field-service software, and which pages do they cite?
      </p>
      <p>
        <Link href="/r/demo">See a sample report</Link> (synthetic data for pest control software in the US).
      </p>
      <p>Free scans are coming soon.</p>
    </main>
  );
}
