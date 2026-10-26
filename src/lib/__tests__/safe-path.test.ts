import { describe, expect, it } from "vitest";
import { safePath } from "../safe-path";

describe("a page to send someone to", () => {
  it("keeps paths on this site", () => {
    expect(safePath("/periods/3?tab=people#p4")).toBe("/periods/3?tab=people#p4");
    expect(safePath("/invite/abc")).toBe("/invite/abc");
  });

  it("refuses anything that leads to another site", () => {
    for (const p of ["https://evil.example", "//evil.example", "/\\evil.example", "/\\/evil.example", "/\t/evil.example", "evil.example", "javascript:alert(1)"]) {
      expect(safePath(p)).toBe("/");
    }
  });

  it("falls back when there's nothing", () => {
    expect(safePath(null, "/welcome")).toBe("/welcome");
    expect(safePath("", "/welcome")).toBe("/welcome");
  });
});
