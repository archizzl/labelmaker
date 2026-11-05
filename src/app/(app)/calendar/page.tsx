import Link from "next/link";
import { connection } from "next/server";
import { MonthBoard } from "@/components/calendar";
import { PlanForm } from "@/components/plan-form";
import { Card, Disclosure, Empty, PageHeader } from "@/components/ui";
import { dayName, isDate, monthOf, planTime } from "@/lib/availability";
import { lastDayOfMonth } from "@/lib/dates";
import { someNames } from "@/lib/plural";
import { bandsOfPeople, calendarGroup, calendarMe, calendarPeople, marksBetween, planPeople, plansBetween, upcomingPlans } from "@/server/calendar";
import { getContext } from "@/server/context";
import { requireCalendar } from "@/server/features";

export const metadata = { title: "calendar" };

/** Everyone's days for a month, your own to mark, and the group's plans. */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  await connection();
  const ctx = await getContext();
  await requireCalendar();
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(sp.month)) ? String(sp.month) : monthOf(today);
  const day = typeof sp.day === "string" && isDate(sp.day) && monthOf(sp.day) === month ? sp.day : null;
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}`;
  const orgId = calendarGroup(ctx);
  const people = await calendarPeople(ctx);
  const me = calendarMe(ctx, people);
  const [marks, monthPlans, upcoming, bands] = await Promise.all([
    marksBetween(
      people.map((p) => p.id),
      from,
      to,
    ),
    plansBetween(orgId, from, to),
    upcomingPlans(orgId, today),
    bandsOfPeople(ctx, people),
  ]);
  const thisYear = today.slice(0, 4);

  return (
    <>
      <PageHeader title="Calendar" />
      <MonthBoard
        key={month}
        month={month}
        today={today}
        people={people}
        me={me}
        marks={marks}
        bands={bands}
        day={day}
        plans={monthPlans.map((p) => ({ id: p.id, title: p.title, date: p.date, startHour: p.startHour, endHour: p.endHour }))}
      />
      <Card title="Plans">
        <Disclosure summary="+ New plan" className="mb-4">
          <PlanForm people={people} bands={bands} today={today} />
        </Disclosure>
        {upcoming.length === 0 ? (
          <Empty>No plans coming up.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.map((p) => {
              const who = planPeople(p, people);
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
                    · {who.length === people.length ? "everyone" : someNames(who.map((w) => w.name.split(" ")[0]), 4)}
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
