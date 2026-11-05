"use client";

import { useState } from "react";
import { MAX_PLAN_DAYS } from "@/lib/availability";
import { savePlan } from "@/server/calendar-actions";
import type { CalendarPerson } from "@/server/calendar";
import { Avatar } from "./avatar";
import { useToday } from "./calendar";
import { ActionForm, SubmitButton } from "./client";
import { Field, buttonClass } from "./ui";

/** Making or changing a plan: its name, the days it could be, who it's for, notes. */
export function PlanForm({
  plan,
  people,
  bands,
  today: serverToday,
}: {
  plan?: { id: number; title: string; notes: string | null; fromDate: string; toDate: string; userIds: string[] | null };
  people: CalendarPerson[];
  bands: { name: string; userIds: string[] }[];
  today: string;
}) {
  const today = useToday(serverToday);
  const [chosen, setChosen] = useState<string[]>(() => (plan?.userIds?.length ? plan.userIds.filter((id) => people.some((p) => p.id === id)) : people.map((p) => p.id)));
  const toggle = (id: string) => setChosen(chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id]);
  const pick = `${buttonClass("secondary", "sm")}`;
  return (
    <ActionForm action={savePlan} className="space-y-4">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <Field label="Name">
        <input name="title" required maxLength={200} defaultValue={plan?.title} />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label="Could be from" className="w-44">
          <input key={today} type="date" name="fromDate" required defaultValue={plan?.fromDate ?? today} />
        </Field>
        <Field label="To" hint={`Up to ${MAX_PLAN_DAYS} days`} className="w-44">
          <input type="date" name="toDate" required defaultValue={plan?.toDate} />
        </Field>
      </div>
      {people.length > 1 && (
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-muted">For</legend>
          <input type="hidden" name="people" value="1" />
          <div className="mb-2 flex flex-wrap gap-1">
            <button type="button" className={pick} onClick={() => setChosen(people.map((p) => p.id))}>
              everyone
            </button>
            {bands.map((b) => (
              <button key={b.name} type="button" className={pick} onClick={() => setChosen(b.userIds)}>
                {b.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="userIds" value={p.id} checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} />
                <Avatar name={p.name} src={p.image} size={18} />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field label="Notes">
        <textarea name="notes" rows={2} maxLength={2000} defaultValue={plan?.notes ?? ""} />
      </Field>
      <SubmitButton>{plan ? "Save" : "Make the plan"}</SubmitButton>
    </ActionForm>
  );
}
