import { ActionForm, SaveWhenChanged, SubmitButton } from "@/components/client";
import { Callout, Card, Empty, Field } from "@/components/ui";
import { abelProvider } from "@/server/abel/config";
import { abelModels, fallbackModels, MAX_MODELS, openRouterModels, savedModels, type ModelSource } from "@/server/abel/models";
import { saveAbelModels } from "@/server/admin-actions";

/*
 * The admin dashboard's Abel tab: which models Abel uses on the AI service he's running on. On
 * OpenRouter, up to three, tried in order; the list to pick from is OpenRouter's models that can
 * use tools, cheapest first.
 */

const SERVICE = { openrouter: "OpenRouter", deepseek: "DeepSeek", gemini: "Gemini" } as const;
const FROM: Record<ModelSource, string> = { admin: "chosen here", env: "from ABEL_MODEL", default: "the defaults" };
const LABELS = ["Model", "If it’s busy", "Then"];

const dollars = (n: number | null) => (n === null ? "?" : `$${n}`);

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
              <input name="model" defaultValue={saved[i] ?? ""} list={catalog ? "openrouter-models" : undefined} autoComplete="off" spellCheck={false} />
            </Field>
          ))}
        </div>
        {catalog && (
          <datalist id="openrouter-models">
            {catalog.map((m) => (
              <option key={m.id} value={m.id} label={`${m.name} · ${dollars(m.inPerMillion)} in, ${dollars(m.outPerMillion)} out per million tokens`} />
            ))}
          </datalist>
        )}
        <p className="text-xs text-muted">With every field empty, Abel uses {fallbackList.join(", then ")}.</p>
        <SaveWhenChanged>
          <SubmitButton size="sm">Save</SubmitButton>
        </SaveWhenChanged>
      </ActionForm>
    </Card>
  );
}
