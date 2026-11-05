import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PlanBoard } from "@/components/calendar";
import { ActionForm, SubmitButton } from "@/components/client";
import { PlanForm } from "@/components/plan-form";
import { Callout, Card, Disclosure, PageHeader } from "@/components/ui";
import { datesBetween, dayName, planTime } from "@/lib/availability";
import { someNames } from "@/lib/plural";
import { bandsOfPeople, calendarGroup, calendarMe, calendarPeople, marksBetween, mayChangePlan, planIn, planPeople } from "@/server/calendar";
import { deletePlanForm, pickPlanDate } from "@/server/calendar-actions";
import { getContext } from "@/server/context";
import { requireCalendar } from "@/server/features";

export const metadata = { title: "plan" };

/** One plan: everyone's days in its range, the best ones, and picking its day. */
export default async function PlanPage({ params }: PageProps<"/calendar/plans/[id]">) {
  await connection();
  const ctx = await getContext();
  await requireCalendar();
  const plan = await planIn(calendarGroup(ctx), Number((await params).id));
  if (!plan) notFound();
  const today = new Date().toISOString().slice(0, 10);
  const everyone = await calendarPeople(ctx);
  const people = planPeople(plan, everyone);
  const dates = datesBetween(plan.fromDate, plan.toDate);
  const [marks, bands] = await Promise.all([
    marksBetween(
      people.map((p) => p.id),
      plan.fromDate,
      plan.toDate,
    ),
    bandsOfPeople(ctx, everyone),
  ]);
  const canChange = mayChangePlan(ctx, plan) && !ctx.viewingAs;
  const thisYear = today.slice(0, 4);

  return (
    <>
      <PageHeader
        title={plan.title}
        subtitle={
          <>
            <Link href={`/calendar?month=${(plan.date ?? plan.fromDate).slice(0, 7)}`}>Calendar</Link> · For{" "}
            {people.length === everyone.length ? "everyone" : someNames(people.map((p) => p.name))}
          </>
        }
      />
      {plan.date ? (
        <Callout tone="good">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>{dayName(plan.date, thisYear)}</strong>, {planTime(plan.startHour, plan.endHour)}
            </span>
            {canChange && (
              <ActionForm action={pickPlanDate}>
                <input type="hidden" name="id" value={plan.id} />
                <input type="hidden" name="date" value="" />
                <SubmitButton variant="ghost" size="sm">
                  Unpick the day
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        </Callout>
      ) : (
        <p className="mb-6 text-sm text-muted">
          No day picked yet. It could be {dayName(plan.fromDate, thisYear)} to {dayName(plan.toDate, thisYear)}.
        </p>
      )}
      {plan.notes && <p className="mb-6 text-sm whitespace-pre-line">{plan.notes}</p>}
      <PlanBoard
        plan={{ id: plan.id, date: plan.date, startHour: plan.startHour, endHour: plan.endHour }}
        canPick={canChange}
        dates={dates}
        today={today}
        people={people}
        me={calendarMe(ctx, people)}
        marks={marks}
      />
      {canChange && (
        <Card>
          <div className="flex flex-wrap items-start gap-3">
            <Disclosure summary="Change the plan">
              <PlanForm plan={plan} people={everyone} bands={bands} today={today} />
            </Disclosure>
            <ActionForm action={deletePlanForm}>
              <input type="hidden" name="id" value={plan.id} />
              <SubmitButton variant="danger-ghost" size="sm" confirm={`Delete “${plan.title}”?`}>
                Delete the plan
              </SubmitButton>
            </ActionForm>
          </div>
        </Card>
      )}
    </>
  );
}
