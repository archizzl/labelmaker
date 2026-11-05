import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PlanBoard } from "@/components/calendar";
import { ActionForm, SubmitButton } from "@/components/client";
import { PlanForm } from "@/components/plan-form";
import { Callout, Card, Disclosure, PageHeader } from "@/components/ui";
import { datesBetween, dayName, planTime } from "@/lib/availability";
import { someNames } from "@/lib/plural";
import { calendarGroup, calendarMe, groupPeople, marksBetween, mayChangePlan, mayDeletePlan, planBands, planBase, planPeople, visiblePlan } from "@/server/calendar";
import { deletePlanForm, pickPlanDate } from "@/server/calendar-actions";
import { getContext } from "@/server/context";

export const metadata = { title: "plan" };

/** One plan: everyone's days in its range, the best ones, and picking its day. */
export default async function PlanPage({ params }: PageProps<"/calendar/plans/[id]">) {
  await connection();
  const ctx = await getContext();
  const plan = await visiblePlan(ctx, Number((await params).id));
  if (!plan) notFound();
  const today = new Date().toISOString().slice(0, 10);
  // Made here (its band can be changed), or a label's plan for this band.
  const ours = plan.orgId === calendarGroup(ctx);
  const base = await planBase(plan);
  const people = planPeople(plan, base);
  const dates = datesBetween(plan.fromDate, plan.toDate);
  const [marks, bands, groupEveryone] = await Promise.all([
    marksBetween(
      people.map((p) => p.id),
      plan.fromDate,
      plan.toDate,
    ),
    ours ? planBands(ctx) : [],
    ours ? groupPeople(plan.orgId) : base,
  ]);
  const thisYear = today.slice(0, 4);
  const who = people.length === base.length ? (plan.bandName ?? "everyone") : someNames(people.map((p) => p.name));

  return (
    <>
      <PageHeader
        title={plan.title}
        subtitle={
          <>
            <Link href={`/calendar?month=${(plan.date ?? plan.fromDate).slice(0, 7)}`}>Calendar</Link> · For {who}
            {!ours && ` · From ${plan.groupName}`}
          </>
        }
      />
      {plan.date ? (
        <Callout tone="good">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>{dayName(plan.date, thisYear)}</strong>, {planTime(plan.startHour, plan.endHour)}
            </span>
            {mayChangePlan(ctx, plan) && (
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
        canPick={mayChangePlan(ctx, plan)}
        dates={dates}
        today={today}
        people={people}
        me={calendarMe(ctx, people)}
        marks={marks}
      />
      {mayChangePlan(ctx, plan) && (
        <Card>
          <div className="flex flex-wrap items-start gap-3">
            <Disclosure summary="Change the plan">
              <PlanForm plan={plan} people={groupEveryone} bands={bands} groupName={ours ? ctx.org.name : (plan.bandName ?? plan.groupName)} today={today} />
            </Disclosure>
            {mayDeletePlan(ctx, plan) && (
              <ActionForm action={deletePlanForm}>
                <input type="hidden" name="id" value={plan.id} />
                <SubmitButton variant="danger-ghost" size="sm" confirm={`Delete “${plan.title}”?`}>
                  Delete the plan
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
