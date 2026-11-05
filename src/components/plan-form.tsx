"use client";

import { useState } from "react";
import { MAX_PLAN_DAYS } from "@/lib/availability";
import { savePlan } from "@/server/calendar-actions";
import type { CalendarPerson } from "@/server/calendar";
import { Avatar } from "./avatar";
import { useToday } from "./calendar";
import { ActionForm, SubmitButton } from "./client";
import { Field } from "./ui";

/**
 * Making or changing a plan: its name, the days it could be, who it's for (in a label, the whole
 * group or one of its bands, then some of them), notes.
 */
export function PlanForm({
  plan,
  people,
  bands,
  groupName,
  today: serverToday,
}: {
  plan?: { id: number; title: string; notes: string | null; fromDate: string; toDate: string; userIds: string[] | null; bandId: number | null };
  /** Everyone in the group. */
  people: CalendarPerson[];
  /** A label's bands it could be for, with their people (empty: not offered). */
  bands: { id: number; name: string; people: CalendarPerson[] }[];
  groupName: string;
  today: string;
}) {
  const today = useToday(serverToday);
  const [bandId, setBandId] = useState(plan?.bandId && bands.some((b) => b.id === plan.bandId) ? plan.bandId : null);
  const base = (id: number | null) => (id ? (bands.find((b) => b.id === id)?.people ?? []) : people);
  const [chosen, setChosen] = useState<string[]>(() => {
    const all = base(bandId).map((p) => p.id);
    return plan?.userIds?.length ? plan.userIds.filter((id) => all.includes(id)) : all;
  });
  const shown = base(bandId);
  const toggle = (id: string) => setChosen(chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id]);
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
      {bands.length > 0 && (
        <Field label="For" className="max-w-xs">
          <select
            name="bandId"
            value={bandId ?? ""}
            onChange={(e) => {
              const id = Number(e.target.value) || null;
              setBandId(id);
              setChosen(base(id).map((p) => p.id));
            }}
          >
            <option value="">Everyone in {groupName}</option>
            {bands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {shown.length > 1 && (
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-muted">{bands.length ? "Who" : "For"}</legend>
          <input type="hidden" name="people" value="1" />
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {shown.map((p) => (
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
