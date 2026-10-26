import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/helpers/db";

// Each request comes from one visitor or another, by Cloudflare's record of their address.
let ip = "203.0.113.1";
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "cf-connecting-ip": ip }) }));

let limits: typeof import("../rate-limit");

beforeAll(async () => {
  await testDb();
  vi.stubEnv("NODE_ENV", "production");
  limits = await import("../rate-limit");
});
afterAll(() => vi.unstubAllEnvs());

describe("rate limits on the sign-in forms", () => {
  it("stop a visitor after 5 tries in a minute, and not anyone else", async () => {
    ip = "203.0.113.1";
    for (let i = 0; i < 5; i++) expect(await limits.tooManyTries("sign-in")).toBe(false);
    expect(await limits.tooManyTries("sign-in")).toBe(true);
    expect(await limits.tooManyTries("sign-up")).toBe(false);
    ip = "203.0.113.2";
    expect(await limits.tooManyTries("sign-in")).toBe(false);
  });

  it("start again after a quiet minute", async () => {
    ip = "203.0.113.3";
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < 6; i++) await limits.tooManyTries("sign-in");
    expect(await limits.tooManyTries("sign-in")).toBe(true);
    vi.setSystemTime(Date.now() + 61_000);
    expect(await limits.tooManyTries("sign-in")).toBe(false);
    vi.useRealTimers();
  });
});
