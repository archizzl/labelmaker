import "server-only";
import { z } from "zod";
import { addDays } from "@/lib/dates";
import { MAX_PLAN_DAYS, datesBetween, dayStatus, hoursName, indexMarks, planTime, rankDays } from "@/lib/availability";
import { calendarMe, calendarPeople, marksBetween, planBase, planPeople, upcomingPlans, visiblePlan } from "../../calendar";
import { deletePlan, pickPlanDate, savePlan, setDays, setHours } from "../../calendar-actions";
import { abelTool, actionTool } from "../tool";
import { date, id, or } from "./shared";

/*
 * The calendar: who in the group is free when, the person's own days, and the group's plans (and
 * its labels' plans for it). Anyone in the group takes part, as on /calendar.
 */

const whoIsFree = abelTool({
  name: "calendar_days",
  description: `Who in the group is free on which days, from one date to another (up to ${MAX_PLAN_DAYS} days), best days first: everyone free all day, then everyone free some hours, then the most people free. Give planId to look at a plan's days and people (and see its picked day), or userIds for some people only. Also lists the plans coming up (the group's own, and its labels' for it). Marks: each person says available or unavailable, for a whole day or single hours; not said isn't free.`,
  params: z.object({
    from: date.optional().describe("Default: today"),
    to: date.optional().describe("Default: 4 weeks on"),
    planId: id.optional(),
    userIds: z.array(z.string()).optional(),
  }),
  needs: "anyone",
  run: async (ctx, a) => {
    const today = new Date().toISOString().slice(0, 10);
    const everyone = await calendarPeople(ctx);
    const plan = a.planId ? await visiblePlan(ctx, a.planId) : null;
    if (a.planId && !plan) return { error: "That plan isn't in this group." };
    const people = plan ? planPeople(plan, await planBase(plan)) : a.userIds?.length ? everyone.filter((p) => a.userIds!.includes(p.id)) : everyone;
    const from = a.from ?? plan?.fromDate ?? today;
    const to = a.to ?? plan?.toDate ?? addDays(today, 27);
    const dates = datesBetween(from, to).slice(0, MAX_PLAN_DAYS);
    const ids = people.map((p) => p.id);
    const book = indexMarks(await marksBetween(ids, dates[0] ?? from, dates.at(-1) ?? to));
    const name = new Map([...everyone, ...people].map((p) => [p.id, p.name]));
    return {
      people: everyone.map((p) => ({ id: p.id, name: p.name, counted: ids.includes(p.id), you: p.id === calendarMe(ctx, everyone) })),
      plan: plan && { id: plan.id, title: plan.title, band: plan.bandName, from: plan.groupName, picked: plan.date ? `${plan.date}, ${planTime(plan.startHour, plan.endHour)}` : null },
      days: rankDays(book, ids, dates)
        .filter((s) => s.yes + s.partly + s.no > 0)
        .slice(0, 20)
        .map((s) => ({
          date: s.date,
          everyoneFree: s.everyone ? "all day" : s.freeHours.length ? hoursName(s.freeHours) : null,
          free: ids.filter((u) => dayStatus(book, u, s.date) === "yes").map((u) => name.get(u)),
          someHours: ids.filter((u) => dayStatus(book, u, s.date) === "partly").map((u) => name.get(u)),
          cant: ids.filter((u) => dayStatus(book, u, s.date) === "no").map((u) => name.get(u)),
          notSaid: s.unmarked,
        })),
      plans: plan
        ? undefined
        : (await upcomingPlans(ctx, today)).map((p) => ({
            id: p.id,
            title: p.title,
            band: p.bandName,
            from: p.groupName,
            picked: p.date ? `${p.date}, ${planTime(p.startHour, p.endHour)}` : null,
            couldBe: `${p.fromDate} to ${p.toDate}`,
            link: `/calendar/plans/${p.id}`,
          })),
      link: plan ? `/calendar/plans/${plan.id}` : `/calendar?month=${from.slice(0, 7)}`,
    };
  },
});

const value = z.enum(["available", "unavailable", "clear"]);
const asValue = (v: z.infer<typeof value>) => (v === "available" ? "yes" : v === "unavailable" ? "no" : "clear");

const markDays = actionTool({
  name: "mark_my_days",
  label: "Mark your days",
  description: "Mark whole days of the person's own as available or unavailable, or clear them (any hours marked on those days go too).",
  params: z.object({ dates: z.array(date).min(1).max(400), value }),
  needs: "anyone",
  action: (fd) => setDays(fd),
  fields: (_ctx, a) => ({ dates: a.dates, value: asValue(a.value) }),
  summary: (_ctx, a) => `Mark ${a.dates.join(", ")} as ${a.value === "clear" ? "not said" : a.value}`,
});

const markHours = actionTool({
  name: "mark_my_hours",
  label: "Mark your hours",
  description: "Mark hours of one of the person's own days as available or unavailable, or clear them (they then follow the day's mark). Hours 0–23, each the hour starting then: 6pm to 9pm is 18, 19, 20.",
  params: z.object({ date, hours: z.array(z.number().int().min(0).max(23)).min(1), value }),
  needs: "anyone",
  action: (fd) => setHours(fd),
  fields: (_ctx, a) => ({ date: a.date, hours: a.hours.map(String), value: asValue(a.value) }),
  summary: (_ctx, a) => `Mark ${a.date}, ${hoursName(a.hours)}, as ${a.value === "clear" ? "not said" : a.value}`,
});

const savePlanTool = actionTool({
  name: "save_plan",
  label: "Save a plan",
  description: `Make a plan (a rehearsal, a show, a meeting) for the days it could be (up to ${MAX_PLAN_DAYS}), or change one (give its id; only the fields given change). In a label, bandId makes it for one of its bands: everyone in the band takes part and it shows in the band's own group too. userIds: some of the people (calendar_days lists them); leave out for all of them. Whoever made a plan, and admins, can change it.`,
  params: z.object({
    id: id.optional(),
    title: z.string().min(1).max(200).optional(),
    bandId: id.nullable().optional().describe("null: the whole group"),
    fromDate: date.optional(),
    toDate: date.optional(),
    userIds: z.array(z.string()).optional(),
    notes: z.string().max(2000).optional(),
  }),
  needs: "anyone",
  items: { id: "plan" },
  action: (fd) => savePlan(null, fd),
  done: "Plan saved.",
  fields: async (ctx, a) => {
    const p = a.id ? await visiblePlan(ctx, a.id) : null;
    if (a.id && !p) throw new Error("That plan isn't in this group.");
    const userIds = or(a.userIds, p?.userIds ?? []);
    const bandId = or(a.bandId, p?.bandId ?? null);
    return {
      id: a.id,
      ...(ctx.org.kind === "label" ? { bandId: bandId ?? "" } : {}),
      title: or(a.title, p?.title),
      fromDate: or(a.fromDate, p?.fromDate),
      toDate: or(a.toDate, p?.toDate),
      notes: or(a.notes, p?.notes ?? undefined),
      ...(userIds.length ? { people: "1", userIds } : {}),
    };
  },
});

const pickDay = actionTool({
  name: "pick_plan_day",
  label: "Pick a plan's day",
  description: "Pick the day for a plan, all day or from startHour up to endHour (0–24: 7pm to 11pm is 19 and 23), or unpick it (date left out).",
  params: z.object({ planId: id, date: date.optional(), startHour: z.number().int().min(0).max(23).optional(), endHour: z.number().int().min(1).max(24).optional() }),
  needs: "anyone",
  items: { planId: "plan" },
  action: (fd) => pickPlanDate(null, fd),
  fields: (_ctx, a) => ({ id: a.planId, date: a.date ?? "", startHour: a.startHour, endHour: a.endHour }),
});

const deletePlanTool = actionTool({
  name: "delete_plan",
  label: "Delete a plan",
  description: "Delete one of the group's plans.",
  params: z.object({ planId: id }),
  needs: "anyone",
  items: { planId: "plan" },
  action: (fd) => deletePlan(fd),
  fields: (_ctx, a) => ({ id: a.planId }),
});

export const CALENDAR_READ_TOOLS = [whoIsFree];
export const CALENDAR_TOOLS = [markDays, markHours, savePlanTool, pickDay, deletePlanTool];
