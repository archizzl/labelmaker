"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { MAX_PLAN_DAYS, type Mark, datesBetween, isDate, isHour, withDays, withHours } from "@/lib/availability";
import type { ActionState } from "./actions";
import { calendarGroup, calendarMe, calendarPeople, groupPeople, bandPeople, mayChangePlan, mayDeletePlan, visiblePlan } from "./calendar";
import { getContext } from "./context";
import { asFormResult } from "./form-result";

const { availability, plans } = schema;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** "yes", "no" or "clear", as a mark. */
function markValue(fd: FormData): boolean | null | undefined {
  const v = str(fd, "value");
  return v === "yes" ? true : v === "no" ? false : v === "clear" ? null : undefined;
}

/** The person themselves, in the group they're in. */
async function me() {
  const ctx = await getContext();
  const userId = calendarMe(ctx, await calendarPeople(ctx));
  if (!userId) throw new Error("Only people who sign in to this group can mark their days.");
  return userId;
}

/** Swap someone's marks on these dates for new ones, worked out from the old (src/lib/availability.ts). */
async function rewrite(userId: string, dates: string[], change: (marks: Mark[]) => Mark[]) {
  await db.transaction(async (tx) => {
    const a = availability;
    const old = await tx
      .select({ userId: a.userId, date: a.date, hour: a.hour, available: a.available })
      .from(a)
      .where(and(eq(a.userId, userId), inArray(a.date, dates)));
    const next = change(old).filter((m) => m.userId === userId && dates.includes(m.date));
    await tx.delete(a).where(and(eq(a.userId, userId), inArray(a.date, dates)));
    if (next.length) await tx.insert(a).values(next);
  });
}

/** Mark whole days available, unavailable, or clear them (value yes, no or clear; dates, any number). */
export async function setDays(fd: FormData): Promise<ActionState> {
  const userId = await me();
  const value = markValue(fd);
  const dates = [...new Set(fd.getAll("dates").map(String))];
  if (value === undefined) return { error: "Choose available, unavailable or clear." };
  if (!dates.length) return { error: "Choose a day." };
  if (dates.length > 400 || !dates.every(isDate)) return { error: "Those aren’t days." };
  await rewrite(userId, dates, (marks) => withDays(marks, userId, dates, value));
  return { ok: "Saved." };
}

/** Mark hours of one day (hours 0–23, each the hour starting then). */
export async function setHours(fd: FormData): Promise<ActionState> {
  const userId = await me();
  const value = markValue(fd);
  const date = str(fd, "date");
  const hours = [...new Set(fd.getAll("hours").map(Number))];
  if (value === undefined) return { error: "Choose available, unavailable or clear." };
  if (!isDate(date)) return { error: "That isn’t a day." };
  if (!hours.length || !hours.every(isHour)) return { error: "Choose hours from 0 to 23." };
  await rewrite(userId, [date], (marks) => withHours(marks, userId, date, hours, value));
  return { ok: "Saved." };
}

/**
 * Make a plan, or change one (id): its title, the days it could be, who it's for (bandId: one of a
 * label's bands; userIds: some of them) and notes. A label's plan for a band shows in the band's
 * group too, whose admins can change it (but not which band it's for).
 */
export async function savePlan(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getContext();
  const orgId = calendarGroup(ctx);
  const title = str(fd, "title");
  const fromDate = str(fd, "fromDate");
  const toDate = str(fd, "toDate") || fromDate;
  if (!title) return { error: "Give the plan a name." };
  if (title.length > 200) return { error: "Keep the name under 200 characters." };
  if (!isDate(fromDate) || !isDate(toDate)) return { error: "Choose the first and last days it could be." };
  if (toDate < fromDate) return { error: "The last day is before the first." };
  if (datesBetween(fromDate, toDate).length > MAX_PLAN_DAYS) return { error: `Choose up to ${MAX_PLAN_DAYS} days.` };

  const id = Number(str(fd, "id")) || null;
  const plan = id ? await visiblePlan(ctx, id) : null;
  if (id && !plan) return { error: "That plan isn’t in this group." };
  if (plan && !mayChangePlan(ctx, plan)) return { error: "Only whoever made the plan, or an admin, can change it." };
  // Which band it's for: chosen in the label that makes it; kept as it is anywhere else.
  const planOrg = plan?.orgId ?? orgId;
  let bandId = plan?.bandId ?? null;
  if (planOrg === orgId && fd.has("bandId")) {
    bandId = Number(str(fd, "bandId")) || null;
    if (bandId) {
      const [band] = await db
        .select({ id: schema.bands.id })
        .from(schema.bands)
        .where(and(eq(schema.bands.orgId, orgId), eq(schema.bands.id, bandId), eq(schema.bands.isLabel, false)));
      if (!band || ctx.org.kind !== "label") return { error: "That band isn’t in this group." };
    }
  }
  const base = bandId ? await bandPeople(planOrg, bandId) : await groupPeople(planOrg);
  if (bandId && !base.length) return { error: "Nobody in that band signs in yet." };
  const chosen = [...new Set(fd.getAll("userIds").map(String))].filter((u) => base.some((p) => p.id === u));
  if (fd.has("people") && !chosen.length) return { error: "Choose who it’s for." };
  const values = {
    title,
    fromDate,
    toDate,
    bandId,
    // All of them ticked is all of them, so people who join later are in it too.
    userIds: chosen.length && chosen.length < base.length ? chosen : null,
    notes: str(fd, "notes").slice(0, 2000) || null,
  };
  if (plan) {
    await db.update(plans).set(values).where(eq(plans.id, plan.id));
    revalidatePath("/calendar", "layout");
    return { ok: "Saved." };
  }
  const [row] = await db
    .insert(plans)
    .values({ ...values, orgId, createdByUserId: ctx.user.id })
    .returning({ id: plans.id });
  revalidatePath("/calendar", "layout");
  redirect(`/calendar/plans/${row.id}`);
}

/** Pick a plan's day (date; empty to unpick it), all day or from startHour to endHour (up to 24). */
export async function pickPlanDate(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getContext();
  const plan = await visiblePlan(ctx, Number(str(fd, "id")));
  if (!plan) return { error: "That plan isn’t in this group." };
  if (!mayChangePlan(ctx, plan)) return { error: "Only whoever made the plan, or an admin, can pick its day." };
  const date = str(fd, "date");
  if (date && !isDate(date)) return { error: "That isn’t a day." };
  let startHour: number | null = null;
  let endHour: number | null = null;
  if (date && str(fd, "startHour") !== "") {
    startHour = Number(str(fd, "startHour"));
    endHour = Number(str(fd, "endHour"));
    if (!isHour(startHour) || !Number.isInteger(endHour) || endHour <= startHour || endHour > 24) return { error: "Choose an end time after the start." };
  }
  await db
    .update(plans)
    .set({ date: date || null, startHour, endHour })
    .where(eq(plans.id, plan.id));
  revalidatePath("/calendar", "layout");
  return { ok: date ? "Day picked." : "Day cleared." };
}

/** Delete a plan (whoever made it, or the admins of the group that made it). */
export async function deletePlan(fd: FormData) {
  const ctx = await getContext();
  const plan = await visiblePlan(ctx, Number(fd.get("id")));
  if (!plan) throw new Error("That plan isn’t in this group.");
  if (!mayDeletePlan(ctx, plan)) throw new Error(`Only whoever made the plan, or an admin of ${plan.groupName}, can delete it.`);
  await db.delete(plans).where(eq(plans.id, plan.id));
  revalidatePath("/calendar", "layout");
  redirect("/calendar");
}

/** deletePlan for its form: errors shown beside it (the redirect still happens). */
export async function deletePlanForm(_: ActionState, fd: FormData): Promise<ActionState> {
  return asFormResult(() => deletePlan(fd));
}
