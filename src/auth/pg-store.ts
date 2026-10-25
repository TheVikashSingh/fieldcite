// Postgres AuthStore (supabase/migrations/20261116000100_magic_link_auth.sql). Server-side only:
// it needs a service-role connection.

import type { Queryable } from "../ledger";
import type { AuthStore, ConsumedLink, LinkPurpose, NewMagicLink } from "./store";

export class PgAuthStore implements AuthStore {
  constructor(private readonly db: Queryable) {}

  async createLink(link: NewMagicLink): Promise<void> {
    await this.db.query(
      "insert into public.magic_links (token_hash, email, purpose, payload, expires_at, created_at) values ($1, $2, $3, $4, $5, $6)",
      [link.tokenHash, link.email, link.purpose, JSON.stringify(link.payload), link.expiresAt, link.createdAt],
    );
  }

  async countLinksSince(email: string, since: Date): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>("select count(*)::int as n from public.magic_links where email = $1 and created_at >= $2", [email, since]);
    return rows[0].n;
  }

  async consumeLink(tokenHash: Buffer, at: Date): Promise<ConsumedLink | null> {
    // One statement, so two clicks racing on the same link can't both succeed.
    const { rows } = await this.db.query<{ email: string; purpose: LinkPurpose; payload: Record<string, unknown> }>(
      `update public.magic_links set used_at = $2
        where token_hash = $1 and used_at is null and expires_at > $2
        returning email, purpose, payload`,
      [tokenHash, at],
    );
    return rows[0] ?? null;
  }

  async upsertVerifiedUser(email: string, at: Date): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `insert into public.users (email, email_verified_at, last_login_at) values ($1, $2, $2)
       on conflict (email) do update
         set email_verified_at = coalesce(public.users.email_verified_at, excluded.email_verified_at),
             last_login_at = excluded.last_login_at
       returning id`,
      [email, at],
    );
    return rows[0].id;
  }

  async ensureAccount(userId: string, email: string): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `with created as (
         insert into public.accounts (owner_id, email) values ($1, $2)
         on conflict (owner_id) do nothing
         returning id
       )
       select id from created
       union all
       select id from public.accounts where owner_id = $1
       limit 1`,
      [userId, email],
    );
    return rows[0].id;
  }
}
