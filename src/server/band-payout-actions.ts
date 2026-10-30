"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { parseCents } from "@/lib/money";
import { requireAdmin } from "./context";
import { syncPeriodStatus } from "./period-status";
import { labelsOfBand } from "./sales-browse";

/*
 * A band that Bandcamp pays itself (bands.paidTo), on its side: it marks its members paid for the
 * label's payouts it sends, and records what it sent the label. Its admins only.
 */

export type BandPayoutState = { ok?: string; error?: string } | null;

/** Mark one of the label's payout lines that the band pays (payouts.paidByBandId) paid, or back to not paid. */
export async function markBandPayout(fd: FormData) {
  const ctx = await requireAdmin();
  const labels = await labelsOfBand(ctx.orgId);
  const id = Number(fd.get("id"));
  const [line] = await db.select().from(schema.payouts).where(eq(schema.payouts.id, id));
  const label = line && labels.find((l) => l.orgId === line.orgId && l.bandId === line.paidByBandId);
  if (!line || !label) throw new Error("That isn’t one of your band’s payouts.");
  const paid = fd.get("status") === "paid";
  await db
    .update(schema.payouts)
    .set({
      status: paid ? "paid" : "pending",
      paidAt: paid ? new Date().toISOString() : null,
      reference: paid ? String(fd.get("reference") ?? "").trim().slice(0, 120) || null : null,
    })
    .where(and(eq(schema.payouts.orgId, label.orgId), eq(schema.payouts.id, id), eq(schema.payouts.paidByBandId, label.bandId)));
  await syncPeriodStatus(label.orgId, line.periodId);
  revalidatePath("/", "layout");
}

/** Record money the band sent a label: the label's share of sales Bandcamp paid the band for. */
export async function recordPaymentToLabel(_: BandPayoutState, fd: FormData): Promise<BandPayoutState> {
  const ctx = await requireAdmin();
  const label = (await labelsOfBand(ctx.orgId)).find((l) => l.linkId === Number(fd.get("linkId")));
  if (!label) return { error: "That isn’t a label your band is on." };
  const date = String(fd.get("date") ?? "");
  const amountCents = parseCents(String(fd.get("amount") ?? ""));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the date you sent it" };
  if (!(amountCents > 0)) return { error: "Enter the amount sent" };
  await db.insert(schema.bandRemittances).values({
    orgId: label.orgId,
    bandId: label.bandId,
    date,
    amountCents,
    currency: (String(fd.get("currency") ?? "") || "USD").toUpperCase().slice(0, 3),
    note: String(fd.get("note") ?? "").trim().slice(0, 500) || null,
  });
  revalidatePath("/", "layout");
  return { ok: "Saved" };
}
