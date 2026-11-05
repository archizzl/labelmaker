import { describe, expect, it } from "vitest";
import {
  type Mark,
  dayStatus,
  freeHours,
  hoursName,
  indexMarks,
  isDate,
  monthWeeks,
  planTime,
  rankDays,
  shiftMonth,
  statusAt,
  summarizeDay,
  withDays,
  withHours,
} from "../availability";

const day = (userId: string, date: string, available: boolean): Mark => ({ userId, date, hour: null, available });
const hour = (userId: string, date: string, h: number, available: boolean): Mark => ({ userId, date, hour: h, available });

describe("a person's day", () => {
  it("lets an hour's mark win over its day's", () => {
    const book = indexMarks([day("a", "2026-11-14", true), hour("a", "2026-11-14", 20, false)]);
    expect(statusAt(book, "a", "2026-11-14", 19)).toBe(true);
    expect(statusAt(book, "a", "2026-11-14", 20)).toBe(false);
    expect(statusAt(book, "a", "2026-11-15", 20)).toBeNull();
    expect(dayStatus(book, "a", "2026-11-14")).toBe("partly");
  });

  it("reads a day with only hours marked as partly, and nothing as not said", () => {
    const book = indexMarks([hour("a", "2026-11-14", 18, true), day("a", "2026-11-15", false)]);
    expect(dayStatus(book, "a", "2026-11-14")).toBe("partly");
    expect(dayStatus(book, "a", "2026-11-15")).toBe("no");
    expect(dayStatus(book, "a", "2026-11-16")).toBeNull();
  });
});

describe("everyone together", () => {
  const marks = [
    day("a", "2026-11-14", true),
    day("b", "2026-11-14", true),
    day("a", "2026-11-15", true),
    hour("b", "2026-11-15", 18, true),
    hour("b", "2026-11-15", 19, true),
    day("a", "2026-11-16", true),
    day("b", "2026-11-16", false),
  ];
  const book = indexMarks(marks);

  it("knows the days everyone's free, all day or some hours", () => {
    expect(summarizeDay(book, ["a", "b"], "2026-11-14")).toMatchObject({ yes: 2, everyone: true });
    expect(summarizeDay(book, ["a", "b"], "2026-11-15")).toMatchObject({ yes: 1, partly: 1, everyone: false, freeHours: [18, 19] });
    expect(summarizeDay(book, ["a", "b"], "2026-11-16")).toMatchObject({ yes: 1, no: 1, everyone: false, freeHours: [] });
  });

  it("needs everyone to have said so: not saying isn't free", () => {
    expect(summarizeDay(book, ["a", "b", "c"], "2026-11-14")).toMatchObject({ yes: 2, unmarked: 1, everyone: false, freeHours: [] });
    expect(freeHours(book, [], "2026-11-14")).toEqual([]);
  });

  it("puts the best days first", () => {
    expect(rankDays(book, ["a", "b"], ["2026-11-16", "2026-11-15", "2026-11-14", "2026-11-17"]).map((s) => s.date)).toEqual([
      "2026-11-14",
      "2026-11-15",
      "2026-11-17",
      "2026-11-16",
    ]);
  });
});

describe("changing marks", () => {
  it("marks whole days, dropping their hours, and clears them", () => {
    const start = [hour("a", "2026-11-14", 20, false), day("b", "2026-11-14", true)];
    const marked = withDays(start, "a", ["2026-11-14", "2026-11-15"], true);
    expect(marked).toEqual([day("b", "2026-11-14", true), day("a", "2026-11-14", true), day("a", "2026-11-15", true)]);
    expect(withDays(marked, "a", ["2026-11-14"], null)).toEqual([day("b", "2026-11-14", true), day("a", "2026-11-15", true)]);
  });

  it("marks hours, with no mark needed where the day already says the same", () => {
    const start = [day("a", "2026-11-14", true)];
    const off = withHours(start, "a", "2026-11-14", [20, 21], false);
    expect(off).toEqual([day("a", "2026-11-14", true), hour("a", "2026-11-14", 20, false), hour("a", "2026-11-14", 21, false)]);
    expect(withHours(off, "a", "2026-11-14", [21], true)).toEqual([day("a", "2026-11-14", true), hour("a", "2026-11-14", 20, false)]);
    expect(withHours(off, "a", "2026-11-14", [20], null)).toEqual([day("a", "2026-11-14", true), hour("a", "2026-11-14", 21, false)]);
  });
});

describe("dates and hours", () => {
  it("lays a month out in weeks from Monday", () => {
    const weeks = monthWeeks("2026-11");
    expect(weeks[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(weeks.at(-1)).toEqual(["2026-11-30", null, null, null, null, null, null]);
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("checks dates", () => {
    expect(isDate("2026-02-28")).toBe(true);
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("26-02-01")).toBe(false);
  });

  it("names hours", () => {
    expect(hoursName([18, 19, 20, 22])).toBe("6pm–9pm, 10pm–11pm");
    expect(hoursName([11, 23])).toBe("11am–noon, 11pm–midnight");
    expect(planTime(null, null)).toBe("all day");
    expect(planTime(19, 23)).toBe("7pm–11pm");
  });
});
