"use client";

import { useSyncExternalStore } from "react";
import { formatDateTime } from "@/lib/dates";

const noop = () => () => {};

/**
 * A stored time ("2026-09-27 14:03:00", in UTC, or an ISO string) in the viewer's own time zone,
 * "Sep 27, 2026, 2:03 PM". The server doesn't know their zone, so it shows the time as stored until
 * the page is running in their browser.
 */
export function LocalTime({ value }: { value: string | Date | null | undefined }) {
  const inBrowser = useSyncExternalStore(noop, () => true, () => false);
  if (!value) return <>—</>;
  const iso = value instanceof Date ? value.toISOString() : /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const at = new Date(iso);
  if (!inBrowser || Number.isNaN(at.getTime())) return <time dateTime={iso}>{formatDateTime(value)}</time>;
  const text = at.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return <time dateTime={iso}>{text}</time>;
}
