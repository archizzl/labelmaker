import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { PROVIDERS, type Provider } from "./config";

/*
 * Which models Abel uses: the ones a site admin chose on the admin dashboard (Abel tab), else
 * ABEL_MODEL, else the service's defaults (config.ts). Kept per service, so switching services
 * never sends one service's model names to another.
 */

/** OpenRouter tries them in order (the next when one is busy); the other services use the first. */
export const MAX_MODELS = 3;

export type ModelSource = "admin" | "env" | "default";

const settingKey = (provider: Provider) => `abel_models:${provider}`;

/** ABEL_MODEL as a list ("a, b" → ["a", "b"]). */
function envModels(): string[] {
  return (process.env.ABEL_MODEL ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

/** The models chosen on the admin dashboard for this service (empty: none chosen). */
export async function savedModels(provider: Provider): Promise<string[]> {
  const [row] = await db.select({ value: schema.siteSettings.value }).from(schema.siteSettings).where(eq(schema.siteSettings.key, settingKey(provider)));
  return Array.isArray(row?.value) ? row.value.filter((m): m is string => typeof m === "string" && m !== "") : [];
}

/** What Abel uses when nothing's chosen on the admin dashboard: ABEL_MODEL, else the defaults. */
export function fallbackModels(provider: Provider): { models: string[]; from: ModelSource } {
  const env = envModels();
  return env.length ? { models: env, from: "env" } : { models: [...PROVIDERS[provider].models], from: "default" };
}

/** The models Abel uses on this service, in order, and where that list came from. */
export async function abelModels(provider: Provider): Promise<{ models: string[]; from: ModelSource }> {
  const saved = await savedModels(provider);
  return saved.length ? { models: saved, from: "admin" } : fallbackModels(provider);
}

/** Save the admin dashboard's choice for this service. An empty list goes back to ABEL_MODEL or the defaults. */
export async function saveModels(provider: Provider, models: string[], userId: string) {
  const key = settingKey(provider);
  if (!models.length) {
    await db.delete(schema.siteSettings).where(eq(schema.siteSettings.key, key));
    return;
  }
  await db
    .insert(schema.siteSettings)
    .values({ key, value: models, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.siteSettings.key, set: { value: models, updatedBy: userId, updatedAt: new Date().toISOString().slice(0, 19).replace("T", " ") } });
}

/** The services' names, as the admin dashboard shows them. */
export const SERVICE_NAMES: Record<Provider, string> = { openrouter: "OpenRouter", deepseek: "DeepSeek", gemini: "Gemini" };

/** A model a service offers. Prices (dollars per million tokens) only from OpenRouter. */
export type ServiceModel = { id: string; name: string; inPerMillion: number | null; outPerMillion: number | null };

/** Dollars per million tokens, from OpenRouter's dollars per token ("0.0000001" → 0.1). */
const perMillion = (perToken: unknown) => {
  const n = Number(perToken);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1000) / 1000 : null;
};

/** A model list's JSON, or null when the service can't be reached or says no. */
async function getJson(url: string, headers: Record<string, string> = {}): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The models this service offers Abel, for the admin dashboard's dropdowns. Null when its list
 * can't be loaded.
 * - OpenRouter: the ones that can call tools (Abel can't work without them), cheapest first. Its
 *   list is public, so no key is needed.
 * - DeepSeek: its whole list (it's short, and they all call tools).
 * - Gemini: the ones that answer chats (generateContent), not embeddings.
 */
export async function serviceModels(provider: Provider): Promise<ServiceModel[] | null> {
  const key = process.env[PROVIDERS[provider].key] ?? "";
  const priced = (id: string, name: unknown, pricing?: { prompt?: unknown; completion?: unknown }): ServiceModel => ({
    id,
    name: typeof name === "string" && name ? name : id,
    inPerMillion: perMillion(pricing?.prompt ?? NaN),
    outPerMillion: perMillion(pricing?.completion ?? NaN),
  });
  if (provider === "openrouter") {
    const json = await getJson("https://openrouter.ai/api/v1/models");
    if (!Array.isArray(json?.data)) return null;
    return (json.data as { id?: unknown; name?: unknown; supported_parameters?: unknown; pricing?: { prompt?: unknown; completion?: unknown } }[])
      .filter((m) => typeof m.id === "string" && Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools"))
      .map((m) => priced(m.id as string, m.name, m.pricing))
      .sort((a, b) => (a.inPerMillion ?? Infinity) - (b.inPerMillion ?? Infinity) || a.id.localeCompare(b.id));
  }
  if (provider === "deepseek") {
    const json = await getJson("https://api.deepseek.com/models", { authorization: `Bearer ${key}` });
    if (!Array.isArray(json?.data)) return null;
    return (json.data as { id?: unknown; name?: unknown }[]).filter((m) => typeof m.id === "string").map((m) => priced(m.id as string, m.name));
  }
  const json = await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { "x-goog-api-key": key });
  if (!Array.isArray(json?.models)) return null;
  return (json.models as { name?: unknown; displayName?: unknown; supportedGenerationMethods?: unknown }[])
    .filter((m) => typeof m.name === "string" && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => priced((m.name as string).replace(/^models\//, ""), m.displayName));
}
