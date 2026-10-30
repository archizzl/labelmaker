import { ActionForm, SaveWhenChanged, SubmitButton } from "@/components/client";
import { Callout, Card, Empty, Field } from "@/components/ui";
import { abelProvider } from "@/server/abel/config";
import { abelModels, fallbackModels, MAX_MODELS, openRouterModels, savedModels, type ModelSource, type OpenRouterModel } from "@/server/abel/models";
import { saveAbelModels } from "@/server/admin-actions";

/*
 * The admin dashboard's Abel tab: which models Abel uses on the AI service he's running on. On
 * OpenRouter, up to three, tried in order, picked from OpenRouter's models that can use tools
 * (by company). A text field instead when the list can't be loaded, or on another service.
 */

const SERVICE = { openrouter: "OpenRouter", deepseek: "DeepSeek", gemini: "Gemini" } as const;
const FROM: Record<ModelSource, string> = { admin: "chosen here", env: "from ABEL_MODEL", default: "the defaults" };
const LABELS = ["Model", "If it’s busy", "Then"];

const dollars = (n: number | null) => (n === null ? "?" : `$${n}`);

/** OpenRouter's models by company ("Anthropic: Claude Haiku 5.5" → Anthropic, Claude Haiku 5.5), both A to Z. */
function byCompany(models: OpenRouterModel[]) {
  const groups = new Map<string, (OpenRouterModel & { model: string })[]>();
  for (const m of models) {
    const [company, model] = m.name.includes(": ") ? [m.name.slice(0, m.name.indexOf(": ")), m.name.slice(m.name.indexOf(": ") + 2)] : [m.id.split("/")[0], m.name];
    groups.set(company, [...(groups.get(company) ?? []), { ...m, model }]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([company, list]) => [company, list.sort((a, b) => a.model.localeCompare(b.model))] as const);
}

export async function AdminAbel() {
  const provider = abelProvider();
  if (!provider)
    return (
      <Card title="Abel">
        <Empty>Abel has no AI service set up.</Empty>
      </Card>
    );
  const openRouter = provider === "openrouter";
  const [saved, inUse, catalog] = await Promise.all([savedModels(provider), abelModels(provider), openRouter ? openRouterModels() : null]);
  const fallbackList = fallbackModels(provider).models;
  const slots = openRouter ? MAX_MODELS : 1;

  return (
    <Card title="Abel">
      <p className="mb-4 text-sm">
        Running on {SERVICE[provider]}: <span className="font-medium">{inUse.models.join(", then ")}</span> <span className="text-muted">({FROM[inUse.from]})</span>
      </p>
      {openRouter && !catalog && <Callout>Couldn’t load OpenRouter’s list of models.</Callout>}
      <ActionForm action={saveAbelModels} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: slots }, (_, i) => (
            <Field key={i} label={LABELS[i]}>
              {catalog ? (
                // Keyed by the saved model, so it shows the new one after a save (the form resets to what it loaded with).
                <select key={saved[i] ?? ""} name="model" defaultValue={saved[i] ?? ""}>
                  <option value="">None</option>
                  {saved[i] && !catalog.some((m) => m.id === saved[i]) && <option value={saved[i]}>{saved[i]} (no longer on OpenRouter)</option>}
                  {byCompany(catalog).map(([company, models]) => (
                    <optgroup key={company} label={company}>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.model} · {dollars(m.inPerMillion)} in, {dollars(m.outPerMillion)} out
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : (
                <input name="model" defaultValue={saved[i] ?? ""} autoComplete="off" spellCheck={false} />
              )}
            </Field>
          ))}
        </div>
        {catalog && <p className="text-xs text-muted">Prices are per million tokens.</p>}
        <p className="text-xs text-muted">With every field empty, Abel uses {fallbackList.join(", then ")}.</p>
        <SaveWhenChanged>
          <SubmitButton size="sm">Save</SubmitButton>
        </SaveWhenChanged>
      </ActionForm>
    </Card>
  );
}
