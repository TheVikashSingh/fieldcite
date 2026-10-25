import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "../../auth/server";
import { getDb } from "../../server/db";

export const metadata: Metadata = { title: "Your account · FieldCite", robots: { index: false } };
export const dynamic = "force-dynamic";

interface ScanRow {
  id: string;
  type: string;
  status: string;
  country: string | null;
  calls_used: number;
  started_at: Date;
}

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/account");
  const db = getDb();
  const account = db
    ? (await db.query<{ id: string; credit_balance: number }>("select id, credit_balance from public.accounts where owner_id = $1", [session.userId])).rows[0]
    : undefined;
  const scans =
    db && account
      ? (await db.query<ScanRow>("select id, type, status, country, calls_used, started_at from public.scans where account_id = $1 order by started_at desc limit 20", [account.id])).rows
      : [];
  return (
    <main className="site-narrow">
      <h1>Your account</h1>
      <p>Signed in as {session.email}.</p>
      <p>Credits: {account?.credit_balance ?? 0} engine calls.</p>
      <h2>Scans</h2>
      {scans.length === 0 ? (
        <p>No scans yet.</p>
      ) : (
        <ul>
          {scans.map((s) => (
            <li key={s.id}>
              {s.started_at.toISOString().slice(0, 10)}: {s.type} scan{s.country ? ` (${s.country})` : ""}, {s.status}, {s.calls_used} calls. The report link is in
              your email.
            </li>
          ))}
        </ul>
      )}
      <form method="post" action="/auth/logout">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
