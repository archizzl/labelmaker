"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type PointerEvent, type ReactNode, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import {
  type Book,
  DAY_HOURS,
  type DaySummary,
  HOURS,
  type Mark,
  WEEKDAYS,
  datesBetween,
  dayName,
  dayStatus,
  hourName,
  hourRuns,
  hoursName,
  indexMarks,
  monthName,
  monthWeeks,
  planTime,
  rankDays,
  shiftMonth,
  statusAt,
  summarizeDay,
  toggleDay,
  toggleHour,
  weekday,
  withDays,
  withHours,
} from "@/lib/availability";
import { pickPlanDate, setDays, setHours } from "@/server/calendar-actions";
import type { CalendarPerson } from "@/server/calendar";
import { Avatar } from "./avatar";
import { ActionForm, SubmitButton, useReadOnly } from "./client";
import { buttonClass } from "./ui";

/*
 * The calendar: everyone's days at a glance, and your own to mark. Marking works as in when2meet:
 * tap a day or drag across several (hours the same, on a day's own grid), and the first one decides
 * what the drag does: marked already, it takes the mark off; otherwise it puts it on (available,
 * or unavailable when that's chosen). Changes show straight away and save in the background.
 */

/** What tapping and dragging mark: available (true) or unavailable. */
type Brush = boolean;
type PlanChip = { id: number; title: string; date: string | null; startHour: number | null; endHour: number | null };

/** Marks as the server sent them, changed here as you paint (and reset when the server sends new ones). */
function useMarks(initial: Mark[]) {
  const [marks, setMarks] = useState(initial);
  const [from, setFrom] = useState(initial);
  if (from !== initial) {
    setFrom(initial);
    setMarks(initial);
  }
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const router = useRouter();
  const save = (next: Mark[], fields: Record<string, string | string[]>, action: (fd: FormData) => Promise<{ error?: string } | null>) => {
    setMarks(next);
    setError(null);
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x);
    start(async () => {
      const r = await action(fd).catch((e: Error) => ({ error: e.message }));
      if (r?.error) {
        setError(r.error);
        router.refresh();
      }
    });
  };
  return { marks, error, save };
}

const valueOf = (v: boolean | null) => (v === true ? "yes" : v === false ? "no" : "clear");

/**
 * Dragging across cells marked data-paint: the run from where it started to where the pointer is
 * (`span` fills in what's between), handed to `commit` when it's let go, with what the drag does
 * (`decide`, from the cell it started on).
 */
type Drag = { from: string; to: string; value: boolean | null };
function usePaint(
  enabled: boolean,
  span: (a: string, b: string) => string[],
  decide: (key: string) => boolean | null,
  commit: (keys: string[], value: boolean | null) => void,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  // The drag as the pointer has it, for letting go (the state can be a render behind a fast drag).
  const live = useRef<Drag | null>(null);
  const keyAt = (e: PointerEvent) => (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-paint]")?.dataset.paint;
  const move = (next: Drag | null) => {
    live.current = next;
    setDrag(next);
  };
  const keys = drag ? span(drag.from, drag.to) : [];
  const props = enabled
    ? {
        onPointerDown: (e: PointerEvent<HTMLElement>) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest("a")) return;
          const k = keyAt(e);
          if (!k) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          move({ from: k, to: k, value: decide(k) });
        },
        onPointerMove: (e: PointerEvent) => {
          const d = live.current;
          const k = d && keyAt(e);
          if (d && k && k !== d.to) move({ ...d, to: k });
        },
        onPointerUp: (e: PointerEvent) => {
          const d = live.current;
          if (d) commit(span(d.from, keyAt(e) ?? d.to), d.value);
          move(null);
        },
        onPointerCancel: () => move(null),
        style: { touchAction: "none" as const, userSelect: "none" as const },
      }
    : {};
  return { painting: new Set(keys), value: drag?.value ?? null, props };
}

/**
 * Today where the person is (the server only knows its own clock): the server's day while the
 * page loads, then theirs.
 */
export function useToday(serverToday: string) {
  return useSyncExternalStore(
    noChanges,
    () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
    () => serverToday,
  );
}
const noChanges = () => () => {};

const daySpan = (a: string, b: string) => (a <= b ? datesBetween(a, b) : datesBetween(b, a));
const hourSpan = (a: string, b: string) => {
  const [x, y] = [Number(a), Number(b)].sort((p, q) => p - q);
  return HOURS.filter((h) => h >= x && h <= y).map(String);
};

const markTone = (v: boolean | null | "partly") =>
  v === true ? "bg-good/35" : v === false ? "bg-bad/25" : v === "partly" ? "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--good)_35%,transparent)_50%,color-mix(in_srgb,var(--bad)_25%,transparent)_50%)]" : "";

function BrushPicker({ brush, setBrush }: { brush: Brush; setBrush: (b: Brush) => void }) {
  const options: { value: Brush; label: string; swatch: string }[] = [
    { value: true, label: "available", swatch: "bg-good" },
    { value: false, label: "unavailable", swatch: "bg-bad" },
  ];
  return (
    <div role="radiogroup" aria-label="Mark days as" className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={brush === o.value}
          onClick={() => setBrush(o.value)}
          className={`${buttonClass("secondary", "sm")} ${brush === o.value ? "border-text! font-bold" : ""}`}
        >
          <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${o.swatch}`} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-sm border border-border text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1 lowercase first:rounded-l-sm last:rounded-r-sm ${value === o.value ? "bg-text font-bold text-bg" : "text-muted hover:text-text"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** "Everyone’s free all day.", "Everyone’s free 6pm–9pm.", "3 of 5 free · 1 can’t." */
function summaryText(s: DaySummary, total: number) {
  if (!total) return "Nobody to check.";
  if (s.everyone) return total === 1 ? "Free all day." : "Everyone’s free all day.";
  if (s.freeHours.length) return `${total === 1 ? "Free" : "Everyone’s free"} ${hoursName(s.freeHours)}.`;
  const parts = [`${s.yes} of ${total} free`];
  if (s.partly) parts.push(`${s.partly} free some hours`);
  if (s.no) parts.push(`${s.no} can’t`);
  if (s.unmarked) parts.push(`${s.unmarked} not said`);
  return `${parts.join(" · ")}.`;
}

/** Choosing whose days count: everyone, a band, or people one by one. */
function WhoPicker({ people, bands, who, setWho }: { people: CalendarPerson[]; bands: { name: string; userIds: string[] }[]; who: string[]; setWho: (w: string[]) => void }) {
  if (people.length < 2) return null;
  const all = who.length === people.length;
  const same = (ids: string[]) => ids.length === who.length && ids.every((i) => who.includes(i));
  const chip = (on: boolean) => `${buttonClass("secondary", "sm")} ${on ? "border-text! font-bold" : "text-muted!"}`;
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Whose days count">
      <button type="button" aria-pressed={all} className={chip(all)} onClick={() => setWho(people.map((p) => p.id))}>
        everyone
      </button>
      {bands.map((b) => (
        <button key={b.name} type="button" aria-pressed={same(b.userIds)} className={chip(same(b.userIds))} onClick={() => setWho(b.userIds)}>
          {b.name}
        </button>
      ))}
      <span aria-hidden className="mx-1 text-border">
        |
      </span>
      {people.map((p) => {
        const on = who.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            className={`${chip(on && !all)} normal-case`}
            onClick={() => setWho(on ? (who.length > 1 ? who.filter((w) => w !== p.id) : who) : [...who, p.id])}
          >
            <Avatar name={p.name} src={p.image} size={16} />
            {p.name.split(" ")[0]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One day, hour by hour: everyone's column, and yours to mark. Below it, `children` (a plan's
 * "pick this day").
 */
function DayHours({
  date,
  people,
  me,
  book,
  marks,
  save,
  brush,
  setBrush,
  plans = [],
  thisYear,
  onClose,
  children,
}: {
  date: string;
  people: CalendarPerson[];
  me: string | null;
  book: Book;
  marks: Mark[];
  save: ReturnType<typeof useMarks>["save"];
  brush: Brush;
  setBrush: (b: Brush) => void;
  plans?: PlanChip[];
  thisYear: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  const readOnly = useReadOnly();
  const [early, setEarly] = useState(false);
  const canMark = !!me && !readOnly;
  const ids = people.map((p) => p.id);
  const summary = summarizeDay(book, ids, date);
  // Your column first.
  const cols = me && people.some((p) => p.id === me) ? [people.find((p) => p.id === me)!, ...people.filter((p) => p.id !== me)] : people;
  const hours = early ? HOURS : DAY_HOURS;
  // Your whole day's mark (what an hour without its own follows).
  const dayMark = marks.find((m) => m.userId === me && m.date === date && m.hour === null)?.available ?? null;
  const { painting, value, props } = usePaint(
    canMark,
    hourSpan,
    (h) => toggleHour(me ? statusAt(book, me, date, Number(h)) : null, dayMark, brush),
    (keys, v) => {
      if (!me) return;
      const hs = keys.map(Number);
      save(withHours(marks, me, date, hs, v), { date, hours: hs.map(String), value: valueOf(v) }, setHours);
    },
  );
  const markDay = (v: boolean | null) => me && save(withDays(marks, me, [date], v), { dates: [date], value: valueOf(v) }, setDays);
  const mine = me ? dayStatus(book, me, date) : null;
  return (
    <section className="mb-10 border border-border p-4" aria-label={dayName(date, thisYear)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">{dayName(date, thisYear)}</h2>
          <p className={`text-sm ${summary.everyone || summary.freeHours.length ? "font-bold text-good" : "text-muted"}`}>{summaryText(summary, ids.length)}</p>
          {plans.map((p) => (
            <p key={p.id} className="text-sm">
              <Link href={`/calendar/plans/${p.id}`}>{p.title}</Link> <span className="text-muted">· {planTime(p.startHour, p.endHour)}</span>
            </p>
          ))}
        </div>
        <button type="button" onClick={onClose} className={buttonClass("ghost", "sm")}>
          close
        </button>
      </div>
      {canMark && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="flex flex-wrap items-center gap-1">
            <span className="text-muted">Your whole day:</span>
            {(
              [
                [true, "available"],
                [false, "unavailable"],
                [null, "clear"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => markDay(v)}
                className={`${buttonClass("secondary", "sm")} ${(v === true && mine === "yes") || (v === false && mine === "no") ? "border-text! font-bold" : ""}`}
              >
                {label}
              </button>
            ))}
          </span>
          <span className="flex flex-wrap items-center gap-1">
            <span className="text-muted">Your hours:</span>
            <BrushPicker brush={brush} setBrush={setBrush} />
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs" {...props}>
          <thead>
            <tr>
              <th className="sticky left-0 bg-surface" />
              <th className="px-1 pb-1 text-center font-medium text-muted">everyone</th>
              {cols.map((p) => (
                <th key={p.id} className="px-1 pb-1 text-center font-medium" title={p.name}>
                  <span className="flex flex-col items-center gap-0.5">
                    <Avatar name={p.name} src={p.image} size={22} />
                    <span className={`max-w-16 truncate ${p.id === me ? "font-bold" : "text-muted"}`}>{p.id === me ? "you" : p.name.split(" ")[0]}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => {
              const free = ids.filter((u) => statusAt(book, u, date, h) === true).length;
              const all = ids.length > 0 && free === ids.length;
              return (
                <tr key={h}>
                  <th scope="row" className="sticky left-0 bg-surface pr-2 text-right font-normal whitespace-nowrap text-muted tabular-nums">
                    {hourName(h)}
                  </th>
                  <td
                    className={`h-6 min-w-16 border border-bg text-center tabular-nums ${all ? "bg-good font-bold text-bg" : ""}`}
                    style={!all && free ? { background: `color-mix(in srgb, var(--good) ${Math.round((free / ids.length) * 45)}%, transparent)` } : undefined}
                  >
                    {all ? "✓" : `${free}/${ids.length}`}
                  </td>
                  {cols.map((p) => {
                    const own = p.id === me && canMark;
                    const st = own && painting.has(String(h)) ? (value ?? dayMark) : statusAt(book, p.id, date, h);
                    return (
                      <td
                        key={p.id}
                        data-paint={own ? String(h) : undefined}
                        aria-label={`${p.id === me ? "You" : p.name}, ${hourName(h)}: ${st === true ? "available" : st === false ? "unavailable" : "not said"}`}
                        className={`h-6 min-w-12 border border-bg ${markTone(st)} ${st === null ? "bg-surface-2/40" : ""} ${own ? "cursor-pointer outline-1 -outline-offset-1 outline-border hover:outline-text" : ""}`}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setEarly(!early)} className={`${buttonClass("ghost", "sm")} mt-1 px-0!`}>
        {early ? "hide early hours" : "show early hours"}
      </button>
      {children}
    </section>
  );
}

/** A month of everyone's days, and your own to mark. */
export function MonthBoard({
  month,
  today: serverToday,
  people,
  me,
  marks: initial,
  plans,
  bands,
  day: initialDay,
}: {
  month: string;
  today: string;
  people: CalendarPerson[];
  me: string | null;
  marks: Mark[];
  plans: PlanChip[];
  bands: { name: string; userIds: string[] }[];
  day: string | null;
}) {
  const readOnly = useReadOnly();
  const today = useToday(serverToday);
  const { marks, error, save } = useMarks(initial);
  const book = useMemo(() => indexMarks(marks), [marks]);
  const canMark = !!me && !readOnly;
  // Someone who hasn't marked anything yet this month starts on their own days.
  const [mode, setMode] = useState<"everyone" | "mine">(() => (canMark && !initial.some((m) => m.userId === me) ? "mine" : "everyone"));
  const [brush, setBrush] = useState<Brush>(true);
  const [who, setWho] = useState(() => people.map((p) => p.id));
  const [selected, setSelected] = useState<string | null>(initialDay);
  const painting = mode === "mine" && canMark;
  const counted = people.filter((p) => who.includes(p.id));
  const weeks = monthWeeks(month);
  const dates = weeks.flat().filter((d): d is string => !!d);
  const summaries = new Map(dates.map((d) => [d, summarizeDay(book, who, d)]));
  const toggle = (d: string) => toggleDay(me ? dayStatus(book, me, d) : null, brush);
  const { painting: pending, value, props } = usePaint(painting, daySpan, toggle, (keys, v) => {
    if (!me) return;
    save(withDays(marks, me, keys, v), { dates: keys, value: valueOf(v) }, setDays);
    if (keys.length === 1) setSelected(keys[0]);
  });
  const free = dates.map((d) => summaries.get(d)!).filter((s) => s.date >= today && (s.everyone || s.freeHours.length));
  const thisYear = today.slice(0, 4);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`/calendar?month=${shiftMonth(month, -1)}`} className={buttonClass("secondary", "sm")} aria-label="Previous month">
            ‹
          </Link>
          <h2 className="min-w-36 text-center text-lg font-bold">{monthName(month)}</h2>
          <Link href={`/calendar?month=${shiftMonth(month, 1)}`} className={buttonClass("secondary", "sm")} aria-label="Next month">
            ›
          </Link>
          {month !== today.slice(0, 7) && (
            <Link href="/calendar" className={buttonClass("ghost", "sm")}>
              today
            </Link>
          )}
        </div>
        {canMark && (
          <Segmented
            label="Show"
            value={mode}
            onChange={setMode}
            options={[
              { value: "everyone", label: "everyone" },
              { value: "mine", label: "my days" },
            ]}
          />
        )}
      </div>
      <div className="mb-3 flex min-h-7 flex-wrap items-center gap-3">
        {painting ? <BrushPicker brush={brush} setBrush={setBrush} /> : <WhoPicker people={people} bands={bands} who={who} setWho={setWho} />}
      </div>
      {error && <p className="mb-2 text-sm text-bad">{error}</p>}

      <div className="mb-6" {...props}>
        <div className="grid grid-cols-7 border-b border-border text-xs text-muted">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-1 pb-1 lowercase">
              {w}
            </div>
          ))}
        </div>
        {weeks.map((week, i) => (
          <div key={i} className="grid grid-cols-7">
            {week.map((d, j) => {
              if (!d) return <div key={j} className="border-r border-b border-border bg-surface-2/40 last:border-r-0" />;
              const s = summaries.get(d)!;
              const past = d < today;
              const mine = me ? dayStatus(book, me, d) : null;
              const shown: boolean | null | "partly" = pending.has(d) ? value : mine === "yes" ? true : mine === "no" ? false : mine;
              const dayPlans = plans.filter((p) => p.date === d);
              const tone = painting
                ? markTone(shown)
                : s.everyone
                  ? "bg-good/30"
                  : s.freeHours.length
                    ? "bg-good/10"
                    : "";
              const label = painting
                ? `${dayName(d, thisYear)}: ${shown === true ? "available" : shown === false ? "unavailable" : shown === "partly" ? "some hours" : "not said"}`
                : `${dayName(d, thisYear)}: ${summaryText(s, counted.length)}`;
              return (
                <div
                  key={d}
                  data-paint={painting ? d : undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  aria-pressed={selected === d}
                  onClick={() => !painting && setSelected(selected === d ? null : d)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    if (painting && me) save(withDays(marks, me, [d], toggle(d)), { dates: [d], value: valueOf(toggle(d)) }, setDays);
                    setSelected(d);
                  }}
                  className={`relative flex min-h-16 cursor-pointer flex-col gap-0.5 border-r border-b border-border p-1 text-left last:border-r-0 md:min-h-24 md:p-1.5 ${tone} ${
                    selected === d ? "outline-2 -outline-offset-2 outline-text" : "hover:outline-1 hover:-outline-offset-1 hover:outline-muted"
                  } ${past ? "opacity-55" : ""}`}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full text-xs tabular-nums ${d === today ? "bg-accent px-1 font-bold text-accent-fg" : ""}`}
                    >
                      {Number(d.slice(8))}
                    </span>
                    {!painting && counted.length > 0 && (
                      <span className={`text-[11px] tabular-nums ${s.everyone ? "font-bold text-good" : "text-muted"}`}>{s.everyone ? "✓" : `${s.yes}/${counted.length}`}</span>
                    )}
                  </span>
                  {!painting && !s.everyone && s.freeHours.length > 0 && <span className="hidden truncate text-[11px] text-good md:block">{hoursName(s.freeHours)}</span>}
                  {painting && shown === "partly" && <span className="hidden text-[11px] text-muted md:block">some hours</span>}
                  {dayPlans.map((p) =>
                    // While you mark your days, a plan's name is only a label: the day under it is what you press.
                    painting ? (
                      <span key={p.id} className="pointer-events-none truncate rounded-sm bg-accent px-1 text-[11px] leading-4 text-accent-fg">
                        {p.title}
                      </span>
                    ) : (
                      <Link
                        key={p.id}
                        href={`/calendar/plans/${p.id}`}
                        draggable={false}
                        onClick={(e) => e.stopPropagation()}
                        className="truncate rounded-sm bg-accent px-1 text-[11px] leading-4 text-accent-fg hover:no-underline"
                      >
                        {p.title}
                      </Link>
                    ),
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {selected && (
        <DayHours
          key={selected}
          date={selected}
          people={counted}
          me={who.includes(me ?? "") ? me : null}
          book={book}
          marks={marks}
          save={save}
          brush={brush}
          setBrush={setBrush}
          plans={plans.filter((p) => p.date === selected)}
          thisYear={thisYear}
          onClose={() => setSelected(null)}
        />
      )}

      {counted.length > 1 && (
        <section className="mb-10">
          <h2 className="mb-2 border-b border-border pb-2 text-base font-bold">{who.length === people.length ? "Days everyone’s free" : `Days all ${counted.length} are free`}</h2>
          {free.length === 0 ? (
            <p className="text-sm text-muted">No days in {monthName(month)} yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {free.map((s) => (
                <li key={s.date}>
                  <button
                    type="button"
                    onClick={() => setSelected(s.date)}
                    className={`${buttonClass("secondary", "sm")} ${s.everyone ? "border-good! text-good!" : ""}`}
                  >
                    <span className="font-bold">{dayName(s.date, thisYear)}</span>
                    {!s.everyone && <span>{hoursName(s.freeHours)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

/** A plan's days, person by person, with the best ones first; picking its day under the day's hours. */
export function PlanBoard({
  plan,
  canPick,
  dates,
  today: serverToday,
  people,
  me,
  marks: initial,
}: {
  plan: { id: number; date: string | null; startHour: number | null; endHour: number | null };
  /** May pick the plan's day (whoever made it, and admins). */
  canPick: boolean;
  dates: string[];
  today: string;
  people: CalendarPerson[];
  me: string | null;
  marks: Mark[];
}) {
  const readOnly = useReadOnly();
  const today = useToday(serverToday);
  const { marks, error, save } = useMarks(initial);
  const book = useMemo(() => indexMarks(marks), [marks]);
  const canMark = !!me && !readOnly && people.some((p) => p.id === me);
  const [brush, setBrush] = useState<Brush>(true);
  const [selected, setSelected] = useState<string | null>(null);
  const ids = people.map((p) => p.id);
  const thisYear = today.slice(0, 4);
  const upcoming = dates.filter((d) => d >= today);
  const best = rankDays(book, ids, upcoming.length ? upcoming : dates)
    .filter((s) => s.yes + s.partly > 0 && (s.no === 0 || s.freeHours.length > 0))
    .slice(0, 5);
  const rows = canMark ? [people.find((p) => p.id === me)!, ...people.filter((p) => p.id !== me)] : people;
  const { painting, value, props } = usePaint(
    canMark,
    (a, b) => daySpan(a, b).filter((d) => dates.includes(d)),
    (d) => toggleDay(me ? dayStatus(book, me, d) : null, brush),
    (keys, v) => {
      if (!me) return;
      save(withDays(marks, me, keys, v), { dates: keys, value: valueOf(v) }, setDays);
    },
  );

  return (
    <>
      <section className="mb-8">
        <h2 className="mb-2 border-b border-border pb-2 text-base font-bold">Best days</h2>
        {best.length === 0 ? (
          <p className="text-sm text-muted">No day suits everyone yet.</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {best.map((s) => (
              <li key={s.date}>
                <button type="button" onClick={() => setSelected(s.date)} className="text-left text-link hover:underline">
                  {dayName(s.date, thisYear)}
                </button>{" "}
                <span className={s.everyone || s.freeHours.length ? "text-good" : "text-muted"}>{summaryText(s, ids.length)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="mb-3 flex min-h-7 flex-wrap items-center gap-3">
        {canMark && (
          <>
            <span className="text-sm text-muted">Mark your days:</span>
            <BrushPicker brush={brush} setBrush={setBrush} />
          </>
        )}
      </div>
      {error && <p className="mb-2 text-sm text-bad">{error}</p>}
      <div className="mb-6 overflow-x-auto">
        <table className="border-collapse text-xs" {...props}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface" />
              {dates.map((d, i) => (
                <th key={d} className={`px-0 pb-1 text-center font-normal ${d < today ? "opacity-55" : ""}`}>
                  <button type="button" onClick={() => setSelected(selected === d ? null : d)} className={`flex w-full flex-col items-center leading-tight ${selected === d ? "font-bold text-text" : "text-muted hover:text-text"}`}>
                    <span className="text-[10px]">{i === 0 || d.endsWith("-01") ? monthName(d.slice(0, 7)).slice(0, 3).toLowerCase() : " "}</span>
                    <span className="text-[10px] lowercase">{WEEKDAYS[weekday(d)].slice(0, 2)}</span>
                    <span className={`tabular-nums ${d === today ? "rounded-full bg-accent px-1 text-accent-fg" : ""}`}>{Number(d.slice(8))}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-surface pr-2 text-left font-medium whitespace-nowrap text-muted">
                everyone
              </th>
              {dates.map((d) => {
                const s = summarizeDay(book, ids, d);
                return (
                  <td
                    key={d}
                    onClick={() => setSelected(selected === d ? null : d)}
                    aria-label={`${dayName(d, thisYear)}: ${summaryText(s, ids.length)}`}
                    className={`h-7 min-w-8 cursor-pointer border border-bg text-center tabular-nums ${s.everyone ? "bg-good font-bold text-bg" : s.freeHours.length ? "bg-good/30 text-good" : "text-muted"} ${selected === d ? "outline-2 -outline-offset-2 outline-text" : ""} ${d < today ? "opacity-55" : ""}`}
                  >
                    {s.everyone ? "✓" : s.freeHours.length ? `${s.freeHours.length}h` : s.yes || ""}
                  </td>
                );
              })}
            </tr>
            {rows.map((p) => (
              <tr key={p.id}>
                <th scope="row" className="sticky left-0 z-10 bg-surface pr-2 text-left font-normal whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    <Avatar name={p.name} src={p.image} size={18} />
                    <span className={p.id === me ? "font-bold" : ""}>{p.id === me ? "you" : p.name}</span>
                  </span>
                </th>
                {dates.map((d) => {
                  const own = p.id === me && canMark;
                  const st = dayStatus(book, p.id, d);
                  const shown: boolean | null | "partly" = own && painting.has(d) ? value : st === "yes" ? true : st === "no" ? false : st;
                  return (
                    <td
                      key={d}
                      data-paint={own ? d : undefined}
                      onClick={own ? undefined : () => setSelected(selected === d ? null : d)}
                      aria-label={`${p.id === me ? "You" : p.name}, ${dayName(d, thisYear)}: ${shown === true ? "available" : shown === false ? "unavailable" : shown === "partly" ? "some hours" : "not said"}`}
                      className={`h-7 min-w-8 border border-bg ${markTone(shown)} ${shown === null ? "bg-surface-2/40" : ""} cursor-pointer ${own ? "outline-1 -outline-offset-1 outline-border hover:outline-text" : ""} ${d < today ? "opacity-55" : ""}`}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <DayHours
          key={selected}
          date={selected}
          people={people}
          me={canMark ? me : null}
          book={book}
          marks={marks}
          save={save}
          brush={brush}
          setBrush={setBrush}
          thisYear={thisYear}
          onClose={() => setSelected(null)}
        >
          {canPick && <PickDay plan={plan} date={selected} freeHours={summarizeDay(book, ids, selected).freeHours} thisYear={thisYear} />}
        </DayHours>
      )}
    </>
  );
}


/** Picking a plan's day: all day, or from one hour to another (to start with, when everyone's free). */
function PickDay({
  plan,
  date,
  freeHours,
  thisYear,
}: {
  plan: { id: number; date: string | null; startHour: number | null; endHour: number | null };
  date: string;
  freeHours: number[];
  thisYear: string;
}) {
  const picked = plan.date === date;
  // The longest time everyone's free, from 8am on if there is one then.
  const daytime = freeHours.filter((h) => DAY_HOURS.includes(h));
  const run = freeHours.length && freeHours.length < 24 ? hourRuns(daytime.length ? daytime : freeHours).sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0] : null;
  const [allDay, setAllDay] = useState(picked ? plan.startHour === null : !run);
  const start = picked && plan.startHour !== null ? plan.startHour : (run?.[0] ?? 19);
  const end = picked && plan.endHour !== null ? plan.endHour : (run?.[1] ?? 22);
  return (
    <ActionForm action={pickPlanDate} keepOpen className="mt-4 border-t border-border pt-4">
      <input type="hidden" name="id" value={plan.id} />
      <input type="hidden" name="date" value={date} />
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All day
        </label>
        {!allDay && (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">From</span>
              <select name="startHour" defaultValue={start} className="w-28!">
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourName(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">To</span>
              <select name="endHour" defaultValue={end} className="w-28!">
                {HOURS.map((h) => h + 1).map((h) => (
                  <option key={h} value={h}>
                    {hourName(h)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <SubmitButton>{picked ? "Save the time" : `Pick ${dayName(date, thisYear)}`}</SubmitButton>
      </div>
    </ActionForm>
  );
}
