import { describe, expect, it } from "vitest";
import { bandcampSubdomain } from "../applications";

describe("an account application's Bandcamp address", () => {
  it("reads Bandcamp subdomains", () => {
    expect(bandcampSubdomain("https://FlagDay.bandcamp.com/album/x")).toBe("flagday");
    expect(bandcampSubdomain("https://example.com")).toBeNull();
  });
});
