import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Mark } from "@/lib/availability";
import type { Context } from "./context";

/*
 * The calendar (src/lib/availability.ts has its rules): the people in a group, when each is free,
 * and the group's plans. It's the group's own, the one the person is in (for a band account the
 * label made, that small account, not the label's books it looks at), and every login in it takes
 * part, the band's shared one too.
 *
 * A label's plan can be for one of its bands: then everyone in the band takes part (the label's
 * people in it who have logins, and everyone in the band's own group), and the plan shows in the
 * band's group as well as the label's.
 */

export type CalendarPerson = { id: string; name: string; image: string | null };

/** A plan, with the band it's for and the group that made it. */
export type Plan = typeof schema.plans.$inferSelect & { bandName: string | null; groupName: string };

/** The group the calendar is for. */
export const calendarGroup = (ctx: Context) => ctx.org.id;

const byName = (a: CalendarPerson, b: CalendarPerson) => a.name.localeCompare(b.name);

async function usersIn(ids: string[]): Promise<CalendarPerson[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(inArray(schema.user.id, [...new Set(ids)]));
  return rows.sort(byName);
}

/** Everyone who signs in to a group, by name. */
export async function groupPeople(orgId: string): Promise<CalendarPerson[]> {
  const rows = await db
    .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, orgId));
  return rows.sort(byName);
}

/** Everyone in the group the person is in. */
export const calendarPeople = (ctx: Context) => groupPeople(calendarGroup(ctx));

/** The logins of each of these bands of a label: its people's own, and everyone in the band's group. */
async function bandLogins(labelOrgId: string, bandIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>(bandIds.map((b) => [b, []]));
  if (!bandIds.length) return out;
  const [members, groups] = await Promise.all([
    db
      .select({ bandId: schema.bandMemberships.bandId, userId: schema.people.userId })
      .from(schema.bandMemberships)
      .innerJoin(schema.people, eq(schema.people.id, schema.bandMemberships.personId))
      .where(and(eq(schema.bandMemberships.orgId, labelOrgId), eq(schema.bandMemberships.active, true), inArray(schema.bandMemberships.bandId, bandIds))),
    db
      .select({ bandId: schema.accountLinks.labelBandId, userId: schema.member.userId })
      .from(schema.accountLinks)
      .innerJoin(schema.member, eq(schema.member.organizationId, schema.accountLinks.bandOrgId))
      .where(and(eq(schema.accountLinks.labelOrgId, labelOrgId), eq(schema.accountLinks.status, "active"), inArray(schema.accountLinks.labelBandId, bandIds))),
  ]);
  for (const r of [...members, ...groups]) if (r.userId && !out.get(r.bandId)!.includes(r.userId)) out.get(r.bandId)!.push(r.userId);
  return out;
}

/** Everyone in one of a label's bands. */
export async function bandPeople(labelOrgId: string, bandId: number): Promise<CalendarPerson[]> {
  return usersIn((await bandLogins(labelOrgId, [bandId])).get(bandId) ?? []);
}

/** A label's bands that have anyone to take part, with who: for a plan's "for". Empty for a band's group. */
export async function planBands(ctx: Context): Promise<{ id: number; name: string; people: CalendarPerson[] }[]> {
  if (ctx.org.kind !== "label") return [];
  const bands = await db
    .select({ id: schema.bands.id, name: schema.bands.name })
    .from(schema.bands)
    .where(and(eq(schema.bands.orgId, ctx.org.id), eq(schema.bands.isLabel, false)))
    .orderBy(asc(schema.bands.name));
  const logins = await bandLogins(
    ctx.org.id,
    bands.map((b) => b.id),
  );
  const people = new Map((await usersIn([...logins.values()].flat())).map((p) => [p.id, p]));
  return bands
    .map((b) => ({ ...b, people: logins.get(b.id)!.map((id) => people.get(id)!).filter(Boolean).sort(byName) }))
    .filter((b) => b.people.length > 0);
}

/** The signed-in person, if they take part here. */
export const calendarMe = (ctx: Context, people: CalendarPerson[]) => (!ctx.viewingAs && people.some((p) => p.id === ctx.user.id) ? ctx.user.id : null);

/** These people's marks from one date to another. */
export async function marksBetween(userIds: string[], from: string, to: string): Promise<Mark[]> {
  if (!userIds.length) return [];
  const a = schema.availability;
  return db
    .select({ userId: a.userId, date: a.date, hour: a.hour, available: a.available })
    .from(a)
    .where(and(inArray(a.userId, userIds), gte(a.date, from), lte(a.date, to)));
}

/** The labels' bands this band's group is (to show the labels' plans for it). */
async function labelBandsOf(ctx: Context) {
  if (ctx.org.kind !== "band") return [];
  return db
    .select({ labelOrgId: schema.accountLinks.labelOrgId, bandId: schema.accountLinks.labelBandId })
    .from(schema.accountLinks)
    .where(and(eq(schema.accountLinks.bandOrgId, ctx.org.id), eq(schema.accountLinks.status, "active")));
}

/** Plans the person's group sees (its own, and its labels' for it), that also match `where`. */
async function visiblePlans(ctx: Context, where?: SQL): Promise<Plan[]> {
  const p = schema.plans;
  const links = await labelBandsOf(ctx);
  const mine = or(eq(p.orgId, calendarGroup(ctx)), ...links.map((l) => and(eq(p.orgId, l.labelOrgId), eq(p.bandId, l.bandId))));
  const rows = await db
    .select({ plan: p, bandName: schema.bands.name, groupName: schema.organization.name })
    .from(p)
    .innerJoin(schema.organization, eq(schema.organization.id, p.orgId))
    .leftJoin(schema.bands, eq(schema.bands.id, p.bandId))
    .where(and(mine, where))
    .orderBy(asc(p.date), asc(p.fromDate));
  return rows.map((r) => ({ ...r.plan, bandName: r.bandName, groupName: r.groupName }));
}

/** The plans that could be or are on these days, and any still to pick a day for. */
export function plansBetween(ctx: Context, from: string, to: string): Promise<Plan[]> {
  const p = schema.plans;
  return visiblePlans(ctx, or(and(lte(p.fromDate, to), gte(p.toDate, from)), and(gte(p.date, from), lte(p.date, to)), isNull(p.date)));
}

/** Plans from today on (and any still to pick a day for), soonest first. */
export function upcomingPlans(ctx: Context, today: string): Promise<Plan[]> {
  const p = schema.plans;
  return visiblePlans(ctx, or(gte(p.date, today), and(isNull(p.date), gte(p.toDate, today))));
}

/** One plan the person's group sees, or null. */
export async function visiblePlan(ctx: Context, id: number): Promise<Plan | null> {
  if (!Number.isInteger(id)) return null;
  const [row] = await visiblePlans(ctx, eq(schema.plans.id, id));
  return row ?? null;
}

/** Everyone a plan could be for: its band's people, or its group's. */
export const planBase = (plan: Pick<Plan, "orgId" | "bandId">) => (plan.bandId ? bandPeople(plan.orgId, plan.bandId) : groupPeople(plan.orgId));

/** Who a plan is for: those it names who are still in, or all of them. */
export function planPeople(plan: Pick<Plan, "userIds">, base: CalendarPerson[]) {
  if (!plan.userIds?.length) return base;
  const named = base.filter((p) => plan.userIds!.includes(p.id));
  return named.length ? named : base;
}

/** Whoever made a plan can change it, and the admins of any group it shows in. */
export const mayChangePlan = (ctx: Context, plan: Pick<Plan, "createdByUserId">) => !ctx.viewingAs && (plan.createdByUserId === ctx.user.id || ctx.org.role !== "member");

/** Deleting: whoever made it, or the admins of the group that made it. */
export const mayDeletePlan = (ctx: Context, plan: Pick<Plan, "createdByUserId" | "orgId">) =>
  !ctx.viewingAs && (plan.createdByUserId === ctx.user.id || (plan.orgId === calendarGroup(ctx) && ctx.org.role !== "member"));

/** Quick picks of whose days count on the month: a label's bands, by who of them is in the group (two or more, not all). */
export function bandPicks(bands: Awaited<ReturnType<typeof planBands>>, people: CalendarPerson[]) {
  return bands
    .map((b) => ({ name: b.name, userIds: b.people.map((p) => p.id).filter((id) => people.some((p) => p.id === id)) }))
    .filter((b) => b.userIds.length >= 2 && b.userIds.length < people.length);
}
