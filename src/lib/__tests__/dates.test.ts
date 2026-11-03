import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatRange, periodName, previousMonth } from "../dates";

describe("period dates", () => {
  it("names common ranges readably", () => {
    expect(periodName("2026-08-01", "2026-08-31")).toBe("August 2026");
    expect(periodName("2026-07-01", "2026-09-30")).toBe("Q3 2026");
    expect(periodName("2026-01-01", "2026-12-31")).toBe("2026");
    expect(periodName("2026-02-01", "2026-04-30")).toBe("February–April 2026");
    expect(periodName("2026-08-03", "2026-09-30")).toBe("Aug 3 – Sep 30, 2026");
    expect(periodName("2025-12-15", "2026-01-15")).toBe("Dec 15, 2025 – Jan 15, 2026");
  });
  it("finds the previous month", () => {
    expect(previousMonth("2026-09-24")).toEqual(["2026-08-01", "2026-08-31"]);
    expect(previousMonth("2026-01-05")).toEqual(["2025-12-01", "2025-12-31"]);
    expect(previousMonth("2024-03-10")).toEqual(["2024-02-01", "2024-02-29"]);
  });
});

describe("shown dates", () => {
  it("formats a date", () => {
    expect(formatDate("2026-01-31")).toBe("Jan 31, 2026");
    expect(formatDate("2026-09-05")).toBe("Sep 5, 2026");
    expect(formatDate("2026-12-31 23:59:59")).toBe("Dec 31, 2026");
    expect(formatDate("2026-12-31T23:59:59.000Z")).toBe("Dec 31, 2026");
    expect(formatDate(new Date(Date.UTC(2026, 0, 1, 23, 30)))).toBe("Jan 1, 2026");
  });
  it("shows an em dash for an empty date", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDateTime(null)).toBe("—");
  });
  it("leaves text that isn't a date as it is", () => {
    expect(formatDate("soon")).toBe("soon");
  });
  it("formats a range", () => {
    expect(formatRange("2026-01-01", "2026-01-31")).toBe("Jan 1 – 31, 2026");
    expect(formatRange("2026-01-01", "2026-02-03")).toBe("Jan 1 – Feb 3, 2026");
    expect(formatRange("2025-12-30", "2026-01-02")).toBe("Dec 30, 2025 – Jan 2, 2026");
    expect(formatRange("2026-03-04", "2026-03-04")).toBe("Mar 4, 2026");
  });
  it("formats a date and time from the string, never the time zone", () => {
    expect(formatDateTime("2026-09-27 14:03:00")).toBe("Sep 27, 2026, 2:03 PM");
    expect(formatDateTime("2026-09-27T00:05:00Z")).toBe("Sep 27, 2026, 12:05 AM");
    expect(formatDateTime("2026-09-27 12:00:00")).toBe("Sep 27, 2026, 12:00 PM");
    expect(formatDateTime("2026-09-27")).toBe("Sep 27, 2026");
  });
});
