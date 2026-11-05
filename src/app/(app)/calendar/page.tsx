import Link from "next/link";
import { connection } from "next/server";
import { MonthBoard } from "@/components/calendar";
import { PlanForm } from "@/components/plan-form";
import { Card, Disclosure, Empty, PageHeader } from "@/components/ui";
import { dayName, isDate, monthOf, planTime } from "@/lib/availability";
import { lastDayOfMonth } from "@/lib/dates";
import { someNames } from "@/lib/plural";
import { bandPicks, calendarGroup, calendarMe, calendarPeople, marksBetween, planBands, plansBetween, upcomingPlans } from "@/server/calendar";
import { getContext } from "@/server/context";

export const metadata = { title: "calendar" };

/** Everyone's days for a month, your own to mark, and the group's plans (and its labels' for it). */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  await connection();
  const ctx = await getContext();
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(sp.month)) ? String(sp.month) : monthOf(today);
  const day = typeof sp.day === "string" && isDate(sp.day) && monthOf(sp.day) === month ? sp.day : null;
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}`;
  const orgId = calendarGroup(ctx);
  const people = await calendarPeople(ctx);
  const [marks, monthPlans, upcoming, bands] = await Promise.all([
    marksBetween(
      people.map((p) => p.id),
      from,
      to,
    ),
    plansBetween(ctx, from, to),
    upcomingPlans(ctx, today),
    planBands(ctx),
  ]);
  const thisYear = today.slice(0, 4);
  const names = new Map(people.map((p) => [p.id, p.name.split(" ")[0]]));

  return (
    <>
      <PageHeader title="Calendar" />
      <MonthBoard
        key={month}
        month={month}
        today={today}
        people={people}
        me={calendarMe(ctx, people)}
        marks={marks}
        bands={bandPicks(bands, people)}
        day={day}
        plans={monthPlans.map((p) => ({ id: p.id, title: p.title, date: p.date, startHour: p.startHour, endHour: p.endHour }))}
      />
      <Card title="Plans">
        {!ctx.viewingAs && (
          <Disclosure summary="+ New plan" className="mb-4">
            <PlanForm people={people} bands={bands} groupName={ctx.org.name} today={today} />
          </Disclosure>
        )}
        {upcoming.length === 0 ? (
          <Empty>No plans coming up.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.map((p) => {
              // Who: the band it's for, some people, or everyone.
              const some = p.userIds?.length ? p.userIds.map((id) => names.get(id)).filter((n): n is string => !!n) : [];
              const who = p.orgId !== orgId ? p.groupName : p.bandName ? p.bandName : some.length ? someNames(some, 4) : "everyone";
              return (
                <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                  <Link href={`/calendar/plans/${p.id}`} className="font-medium">
                    {p.title}
                  </Link>
                  <span className="text-sm text-muted">
                    {p.date ? (
                      <span className="text-text">
                        {dayName(p.date, thisYear)}, {planTime(p.startHour, p.endHour)}
                      </span>
                    ) : (
                      <>No day yet · {dayName(p.fromDate, thisYear)} to {dayName(p.toDate, thisYear)}</>
                    )}{" "}
                    · {who}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
