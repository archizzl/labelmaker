import { addDays, isoDate, lastDayOfMonth } from "./dates";

/*
 * The calendar's rules: who's free when. Someone marks a whole day (available or not), or single
 * hours of it; an hour's own mark wins over its day's. Unmarked is neither: "everyone's free" needs
 * everyone to have said so.
 */

export type Mark = { userId: string; date: string; hour: number | null; available: boolean };

/** A person's day: a mark for all of it, or some hours, or a mix (hours differing from the day). */
export type DayStatus = "yes" | "no" | "partly" | null;

type DayMarks = { day: boolean | null; hours: Map<number, boolean> };

/** Everyone's marks, by person and date. */
export type Book = Map<string, Map<string, DayMarks>>;

export const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** The hours shown unless early ones are asked for: 8am to midnight. */
export const DAY_HOURS = HOURS.filter((h) => h >= 8);

export const MAX_PLAN_DAYS = 92;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
export const isHour = (h: number) => Number.isInteger(h) && h >= 0 && h <= 23;

export function indexMarks(marks: Mark[]): Book {
  const book: Book = new Map();
  for (const m of marks) {
    let days = book.get(m.userId);
    if (!days) book.set(m.userId, (days = new Map()));
    let d = days.get(m.date);
    if (!d) days.set(m.date, (d = { day: null, hours: new Map() }));
    if (m.hour === null) d.day = m.available;
    else d.hours.set(m.hour, m.available);
  }
  return book;
}

/** Whether someone's free at this hour of this day: true, false, or null for not said. */
export function statusAt(book: Book, userId: string, date: string, hour: number): boolean | null {
  const d = book.get(userId)?.get(date);
  if (!d) return null;
  return d.hours.get(hour) ?? d.day;
}

/** Someone's whole day, as one word. */
export function dayStatus(book: Book, userId: string, date: string): DayStatus {
  const d = book.get(userId)?.get(date);
  if (!d) return null;
  const differing = [...d.hours.values()].filter((v) => v !== d.day);
  if (!differing.length) return d.day === null ? null : d.day ? "yes" : "no";
  return "partly";
}

/** The hours (of `hours`) everyone in `userIds` is free. */
export function freeHours(book: Book, userIds: string[], date: string, hours: number[] = HOURS): number[] {
  if (!userIds.length) return [];
  return hours.filter((h) => userIds.every((u) => statusAt(book, u, date, h) === true));
}

export type DaySummary = {
  date: string;
  yes: number;
  partly: number;
  no: number;
  unmarked: number;
  /** Everyone's free all day. */
  everyone: boolean;
  /** The hours everyone's free (all of them when `everyone`). */
  freeHours: number[];
};

export function summarizeDay(book: Book, userIds: string[], date: string): DaySummary {
  const s = { date, yes: 0, partly: 0, no: 0, unmarked: 0 };
  for (const u of userIds) {
    const st = dayStatus(book, u, date);
    if (st === "yes") s.yes++;
    else if (st === "no") s.no++;
    else if (st === "partly") s.partly++;
    else s.unmarked++;
  }
  const everyone = userIds.length > 0 && s.yes === userIds.length;
  return { ...s, everyone, freeHours: everyone ? HOURS : freeHours(book, userIds, date) };
}

/**
 * The best of these days for everyone in `userIds`: everyone free all day first, then everyone free
 * some hours (most hours first), then the most people free; days anyone can't make it come last.
 * Ties go to the earlier day.
 */
export function rankDays(book: Book, userIds: string[], dates: string[]): DaySummary[] {
  const score = (s: DaySummary) => (s.everyone ? 3_000_000 : s.freeHours.length ? 2_000_000 + s.freeHours.length * 1000 : 1_000_000) + (s.yes + s.partly / 2) * 10 - s.no * 100;
  return dates
    .map((d) => summarizeDay(book, userIds, d))
    .sort((a, b) => score(b) - score(a) || a.date.localeCompare(b.date));
}

/*
 * Changing someone's marks (the server saves the same thing the page shows straight away).
 */

/** Marks whole days available, unavailable or not said (null). Any hours marked on them go. */
export function withDays(marks: Mark[], userId: string, dates: string[], value: boolean | null): Mark[] {
  const set = new Set(dates);
  const kept = marks.filter((m) => m.userId !== userId || !set.has(m.date));
  return value === null ? kept : [...kept, ...[...set].map((date) => ({ userId, date, hour: null, available: value }))];
}

/**
 * Marks hours of one day. An hour marked the same as its day needs no mark of its own; cleared
 * (null), it follows the day again.
 */
export function withHours(marks: Mark[], userId: string, date: string, hours: number[], value: boolean | null): Mark[] {
  const set = new Set(hours);
  const day = marks.find((m) => m.userId === userId && m.date === date && m.hour === null)?.available ?? null;
  const kept = marks.filter((m) => m.userId !== userId || m.date !== date || m.hour === null || !set.has(m.hour));
  if (value === null || value === day) return kept;
  return [...kept, ...[...set].map((hour) => ({ userId, date, hour, available: value }))];
}

/*
 * Dates and hours, shown.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** 0 for Monday … 6 for Sunday. */
export const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "2026-11" for a date. */
export const monthOf = (date: string) => date.slice(0, 7);

export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

export const monthName = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

/** A month as weeks, Monday first; days outside it are null. */
export function monthWeeks(month: string): (string | null)[][] {
  const [y, m] = month.split("-").map(Number);
  const days: (string | null)[] = Array(weekday(isoDate(y, m, 1))).fill(null);
  for (let d = 1; d <= lastDayOfMonth(y, m); d++) days.push(isoDate(y, m, d));
  while (days.length % 7) days.push(null);
  return Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
}

/** "Fri 14 Nov" (with the year when it isn't `thisYear`). */
export function dayName(date: string, thisYear?: string) {
  const [y, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[weekday(date)]} ${d} ${MONTHS[m - 1].slice(0, 3)}${thisYear && String(y) !== thisYear ? ` ${y}` : ""}`;
}

/** "6pm", "12am"; 24 is "midnight" (the end of the last hour). */
export function hourName(h: number) {
  if (h === 24) return "midnight";
  if (h === 12) return "noon";
  return `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
}

/** Hours as runs: [18, 19, 20, 22] is [[18, 21], [22, 23]] (each up to, not including, its end). */
export function hourRuns(hours: number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const h of [...new Set(hours)].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && last[1] === h) last[1] = h + 1;
    else runs.push([h, h + 1]);
  }
  return runs;
}

/** "6pm–9pm, 10pm–11pm"; "all day" for every hour. */
export function hoursName(hours: number[]) {
  if (hours.length >= 24) return "all day";
  return hourRuns(hours)
    .map(([a, b]) => `${hourName(a)}–${hourName(b)}`)
    .join(", ");
}

/** A plan's time: "all day", or "6pm–10pm". */
export const planTime = (startHour: number | null, endHour: number | null) =>
  startHour === null ? "all day" : `${hourName(startHour)}–${hourName(endHour ?? startHour + 1)}`;
