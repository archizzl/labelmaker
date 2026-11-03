const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const parse = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
};

export function lastDayOfMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The whole of the month before `today`. */
export function previousMonth(today: string): [string, string] {
  const { y, m } = parse(today);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return [isoDate(py, pm, 1), isoDate(py, pm, lastDayOfMonth(py, pm))];
}

/**
 * A readable name for a date range: "August 2026", "Q3 2026", "2026", or "Aug 3 – Sep 30, 2026".
 */
export function periodName(start: string, end: string): string {
  const a = parse(start);
  const b = parse(end);
  const wholeMonths = a.d === 1 && b.d === lastDayOfMonth(b.y, b.m);
  if (wholeMonths && a.y === b.y) {
    if (a.m === b.m) return `${MONTHS[a.m - 1]} ${a.y}`;
    if (a.m === 1 && b.m === 12) return `${a.y}`;
    if ((a.m - 1) % 3 === 0 && b.m === a.m + 2) return `Q${(a.m + 2) / 3} ${a.y}`;
    return `${MONTHS[a.m - 1]}–${MONTHS[b.m - 1]} ${a.y}`;
  }
  const short = (p: { m: number; d: number }) => `${MONTHS[p.m - 1].slice(0, 3)} ${p.d}`;
  return a.y === b.y ? `${short(a)} – ${short(b)}, ${a.y}` : `${short(a)}, ${a.y} – ${short(b)}, ${b.y}`;
}

export const SALES_RANGES = [
  { key: "all", label: "all time" },
  { key: "12m", label: "last 12 months" },
  { key: "ytd", label: "this year" },
  { key: "90d", label: "last 90 days" },
] as const;
export type SalesRange = (typeof SALES_RANGES)[number]["key"];

/** The dates a sales range covers, ending today. */
export function salesRangeDates(range: string | undefined, today: string): { key: SalesRange; from?: string; to?: string } {
  const { y } = parse(today);
  switch (range) {
    case "12m":
      return { key: "12m", from: addDays(today, -364), to: today };
    case "ytd":
      return { key: "ytd", from: isoDate(y, 1, 1), to: today };
    case "90d":
      return { key: "90d", from: addDays(today, -89), to: today };
    default:
      return { key: "all" };
  }
}

// Dates shown to people. Each reads the date (and time) straight from the string, never the
// machine's time zone, so the server and the browser always agree.

const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

/** Year, month and day (and hour and minute when there's a time) from "2026-01-31", "2026-01-31 14:03:00" or "2026-01-31T14:03:00Z". */
function parts(value: string | Date) {
  const s = value instanceof Date ? value.toISOString() : value;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  return {
    y: Number(m[1]),
    m: Number(m[2]),
    d: Number(m[3]),
    hour: m[4] === undefined ? null : Number(m[4]),
    minute: m[5] === undefined ? null : Number(m[5]),
  };
}

/** "2026-01-31" (or a timestamp) → "Jan 31, 2026". Empty → "—". */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const p = parts(value);
  return p ? `${SHORT_MONTHS[p.m - 1]} ${p.d}, ${p.y}` : String(value);
}

/** "Jan 1 – 31, 2026", "Jan 1 – Feb 3, 2026" or "Dec 30, 2025 – Jan 2, 2026"; a single day is just that date. */
export function formatRange(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (!a || !b || a.y !== b.y) return `${formatDate(start)} – ${formatDate(end)}`;
  if (a.m !== b.m) return `${SHORT_MONTHS[a.m - 1]} ${a.d} – ${SHORT_MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
  if (a.d !== b.d) return `${SHORT_MONTHS[a.m - 1]} ${a.d} – ${b.d}, ${b.y}`;
  return formatDate(start);
}

/** "2026-09-27 14:03:00" → "Sep 27, 2026, 2:03 PM", the time as stored. Just the date when there's no time. Empty → "—". */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const p = parts(value);
  if (!p) return String(value);
  if (p.hour === null || p.minute === null) return formatDate(value);
  const h = p.hour % 12 || 12;
  return `${formatDate(value)}, ${h}:${String(p.minute).padStart(2, "0")} ${p.hour < 12 ? "AM" : "PM"}`;
}
