"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { MAX_PLAN_DAYS, type Mark, datesBetween, isDate, isHour, withDays, withHours } from "@/lib/availability";
import type { ActionState } from "./actions";
import { calendarGroup, calendarMe, calendarPeople, mayChangePlan, planIn } from "./calendar";
import { getContext } from "./context";
import { requireCalendar } from "./features";
import { asFormResult } from "./form-result";

const { availability, plans } = schema;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** "yes", "no" or "clear", as a mark. */
function markValue(fd: FormData): boolean | null | undefined {
  const v = str(fd, "value");
  return v === "yes" ? true : v === "no" ? false : v === "clear" ? null : undefined;
}

/** The person themselves, in the group they're in (a band's shared login has no days of its own). */
async function me() {
  const ctx = await getContext();
  await requireCalendar();
  const people = await calendarPeople(ctx);
  const userId = calendarMe(ctx, people);
  if (!userId) throw new Error("Only people with their own account can mark their days.");
  return { ctx, userId, people };
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
  const { userId } = await me();
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
  const { userId } = await me();
  const value = markValue(fd);
  const date = str(fd, "date");
  const hours = [...new Set(fd.getAll("hours").map(Number))];
  if (value === undefined) return { error: "Choose available, unavailable or clear." };
  if (!isDate(date)) return { error: "That isn’t a day." };
  if (!hours.length || !hours.every(isHour)) return { error: "Choose hours from 0 to 23." };
  await rewrite(userId, [date], (marks) => withHours(marks, userId, date, hours, value));
  return { ok: "Saved." };
}

/** Make a plan, or change one (id): its title, the days it could be, who it's for and notes. */
export async function savePlan(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getContext();
  await requireCalendar();
  const orgId = calendarGroup(ctx);
  const title = str(fd, "title");
  const fromDate = str(fd, "fromDate");
  const toDate = str(fd, "toDate") || fromDate;
  if (!title) return { error: "Give the plan a name." };
  if (title.length > 200) return { error: "Keep the name under 200 characters." };
  if (!isDate(fromDate) || !isDate(toDate)) return { error: "Choose the first and last days it could be." };
  if (toDate < fromDate) return { error: "The last day is before the first." };
  if (datesBetween(fromDate, toDate).length > MAX_PLAN_DAYS) return { error: `Choose up to ${MAX_PLAN_DAYS} days.` };
  const people = await calendarPeople(ctx);
  const chosen = [...new Set(fd.getAll("userIds").map(String))].filter((id) => people.some((p) => p.id === id));
  if (fd.has("people") && !chosen.length) return { error: "Choose who it’s for." };
  const values = {
    title,
    fromDate,
    toDate,
    // Everyone ticked is everyone, so people who join later are in it too.
    userIds: chosen.length && chosen.length < people.length ? chosen : null,
    notes: str(fd, "notes").slice(0, 2000) || null,
  };
  const id = Number(str(fd, "id")) || null;
  if (id) {
    const plan = await planIn(orgId, id);
    if (!plan) return { error: "That plan isn’t in this group." };
    if (!mayChangePlan(ctx, plan)) return { error: "Only whoever made the plan, or an admin, can change it." };
    await db.update(plans).set(values).where(and(eq(plans.orgId, orgId), eq(plans.id, id)));
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
  await requireCalendar();
  const orgId = calendarGroup(ctx);
  const plan = await planIn(orgId, Number(str(fd, "id")));
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
    .where(and(eq(plans.orgId, orgId), eq(plans.id, plan.id)));
  revalidatePath("/calendar", "layout");
  return { ok: date ? "Day picked." : "Day cleared." };
}

/** Delete a plan. */
export async function deletePlan(fd: FormData) {
  const ctx = await getContext();
  await requireCalendar();
  const orgId = calendarGroup(ctx);
  const plan = await planIn(orgId, Number(fd.get("id")));
  if (!plan) throw new Error("That plan isn’t in this group.");
  if (!mayChangePlan(ctx, plan)) throw new Error("Only whoever made the plan, or an admin, can delete it.");
  await db.delete(plans).where(and(eq(plans.orgId, orgId), eq(plans.id, plan.id)));
  revalidatePath("/calendar", "layout");
  redirect("/calendar");
}

/** deletePlan for its form: errors shown beside it (the redirect still happens). */
export async function deletePlanForm(_: ActionState, fd: FormData): Promise<ActionState> {
  return asFormResult(() => deletePlan(fd));
}
