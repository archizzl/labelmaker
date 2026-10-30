import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/helpers/db";

// A site admin, without a sign-in.
const admin = vi.hoisted(() => ({ id: "" }));
vi.mock("../site-admin", () => ({ requireSiteAdmin: async () => ({ user: { id: admin.id } }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let models: typeof import("../abel/models");
let actions: typeof import("../admin-actions");

/** OpenRouter's model list, as its API gives it. */
const OPENROUTER_LIST = {
  data: [
    { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash", supported_parameters: ["tools"], pricing: { prompt: "0.0000001", completion: "0.0000004" } },
    { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5", supported_parameters: ["tools"], pricing: { prompt: "0.000001", completion: "0.000005" } },
    { id: "someone/no-tools", name: "No tools", supported_parameters: ["temperature"], pricing: { prompt: "0", completion: "0" } },
  ],
};

beforeAll(async () => {
  const { db, schema } = await testDb();
  admin.id = randomUUID();
  await db.insert(schema.user).values({ id: admin.id, name: "Admin", email: `${admin.id.slice(0, 8)}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  models = await import("../abel/models");
  actions = await import("../admin-actions");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const form = (...names: string[]) => {
  const fd = new FormData();
  for (const n of names) fd.append("model", n);
  return fd;
};

describe("Abel's models", () => {
  it("uses the defaults, then ABEL_MODEL, then what's chosen on the admin dashboard", async () => {
    expect(await models.abelModels("openrouter")).toEqual({ models: ["google/gemini-3.8-flash", "anthropic/claude-haiku-5.5"], from: "default" });
    vi.stubEnv("ABEL_MODEL", "a/b, c/d");
    expect(await models.abelModels("openrouter")).toEqual({ models: ["a/b", "c/d"], from: "env" });
    await models.saveModels("openrouter", ["anthropic/claude-haiku-5.5"], admin.id);
    expect(await models.abelModels("openrouter")).toEqual({ models: ["anthropic/claude-haiku-5.5"], from: "admin" });
    // Kept per service.
    expect((await models.abelModels("deepseek")).from).toBe("env");
    await models.saveModels("openrouter", [], admin.id);
    expect((await models.abelModels("openrouter")).from).toBe("env");
  });

  it("lists OpenRouter's models that can use tools, cheapest first, in dollars per million tokens", async () => {
    vi.stubGlobal("fetch", async () => Response.json(OPENROUTER_LIST));
    expect(await models.serviceModels("openrouter")).toEqual([
      { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash", inPerMillion: 0.1, outPerMillion: 0.4 },
      { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5", inPerMillion: 1, outPerMillion: 5 },
    ]);
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    expect(await models.serviceModels("openrouter")).toBeNull();
  });

  it("lists DeepSeek's models, and Gemini's that answer chats, with the service's key", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "ds-key");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    const sent: Record<string, string>[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push(init.headers as Record<string, string>);
      return url.includes("deepseek")
        ? Response.json({ data: [{ id: "deepseek-flash", name: "DeepSeek-V4.1-Flash" }, { id: "deepseek-v4-pro" }] })
        : Response.json({
            models: [
              { name: "models/gemini-3.8-flash", displayName: "Gemini 3.8 Flash", supportedGenerationMethods: ["generateContent"] },
              { name: "models/text-embedding", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
            ],
          });
    });
    expect(await models.serviceModels("deepseek")).toEqual([
      { id: "deepseek-flash", name: "DeepSeek-V4.1-Flash", inPerMillion: null, outPerMillion: null },
      { id: "deepseek-v4-pro", name: "deepseek-v4-pro", inPerMillion: null, outPerMillion: null },
    ]);
    expect(await models.serviceModels("gemini")).toEqual([{ id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", inPerMillion: null, outPerMillion: null }]);
    expect(sent).toEqual([{ authorization: "Bearer ds-key" }, { "x-goog-api-key": "g-key" }]);
  });
});

describe("saving them from the admin dashboard", () => {
  it("saves models OpenRouter has, in order, and an empty form goes back to the defaults", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "key");
    vi.stubGlobal("fetch", async () => Response.json(OPENROUTER_LIST));
    expect(await actions.saveAbelModels(null, form("anthropic/claude-haiku-5.5", "google/gemini-3.8-flash", ""))).toEqual({
      ok: "Saved. Abel uses anthropic/claude-haiku-5.5, then google/gemini-3.8-flash.",
    });
    expect(await models.savedModels("openrouter")).toEqual(["anthropic/claude-haiku-5.5", "google/gemini-3.8-flash"]);
    expect(await actions.saveAbelModels(null, form("", "", ""))).toEqual({ ok: "Saved. Abel uses google/gemini-3.8-flash, then anthropic/claude-haiku-5.5." });
    expect(await models.savedModels("openrouter")).toEqual([]);
  });

  it("turns down a model DeepSeek doesn't have", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "ds-key");
    vi.stubGlobal("fetch", async () => Response.json({ data: [{ id: "deepseek-flash" }] }));
    expect(await actions.saveAbelModels(null, form("deepseek-nope"))).toEqual({ error: "DeepSeek has no model called “deepseek-nope”." });
    expect(await actions.saveAbelModels(null, form("deepseek-flash"))).toEqual({ ok: "Saved. Abel uses deepseek-flash." });
    expect(await models.savedModels("deepseek")).toEqual(["deepseek-flash"]);
  });

  it("turns down models OpenRouter doesn't have or that can't use tools, and too many", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "key");
    vi.stubGlobal("fetch", async () => Response.json(OPENROUTER_LIST));
    expect(await actions.saveAbelModels(null, form("someone/no-tools"))).toEqual({ error: "OpenRouter has no model called “someone/no-tools” that can use tools." });
    expect(await actions.saveAbelModels(null, form("not a model"))).toEqual({ error: "“not a model” isn’t a model name." });
    expect(await actions.saveAbelModels(null, form("a/1", "a/2", "a/3", "a/4"))).toEqual({ error: "At most 3 models." });
    expect(await models.savedModels("openrouter")).toEqual([]);
  });
});
