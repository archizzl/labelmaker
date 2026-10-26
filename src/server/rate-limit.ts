import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/db";

/*
 * Rate limits for the sign-in, sign-up and password forms. Better Auth limits requests to its own
 * endpoints (src/server/auth.ts), but not the calls server actions make to it, which is how these
 * forms work. Kept in Better Auth's table, so every server shares the count.
 */

const { rateLimit } = schema;

/** The visitor's address: on the live site, Cloudflare's record of it, which they can't set themselves. */
async function visitor() {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * Count one try at `action` from this visitor: true once they've made more than `max` with no
 * pause of `windowSeconds` between them. (Off outside the live build, like Better Auth's.)
 */
export async function tooManyTries(action: string, max = 5, windowSeconds = 60): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return false;
  const now = Date.now();
  const [row] = await db
    .insert(rateLimit)
    .values({ id: randomUUID(), key: `form|${await visitor()}|${action}`, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${rateLimit.lastRequest} < ${now - windowSeconds * 1000} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: now,
      },
    })
    .returning({ count: rateLimit.count });
  return row.count > max;
}

export const TOO_MANY_TRIES = "Too many tries. Wait a minute, then try again.";
