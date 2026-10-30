import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

/** A payout is "paid" once every line is settled: paid, kept in the label account, or nothing owed. */
export async function syncPeriodStatus(orgId: string, periodId: number) {
  const rows = await db.select().from(schema.payouts).where(eq(schema.payouts.periodId, periodId));
  const settled = rows.every((r) => r.status !== "pending" || r.amountCents <= 0);
  await db
    .update(schema.periods)
    .set({ status: settled ? "paid" : "finalized" })
    .where(and(eq(schema.periods.orgId, orgId), eq(schema.periods.id, periodId)));
}
