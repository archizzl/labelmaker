import { ActionForm, SaveWhenChanged, SubmitButton } from "@/components/client";
import { FilterList } from "@/components/filter-list";
import { Callout, Card, Empty, Field } from "@/components/ui";
import { AREAS } from "@/lib/permissions";
import { ABEL_TOOLS } from "@/server/abel/agent";
import { abelProvider } from "@/server/abel/config";
import { abelModels, fallbackModels, MAX_MODELS, savedModels, SERVICE_NAMES, serviceModels, type ModelSource, type ServiceModel } from "@/server/abel/models";
import type { AbelTool } from "@/server/abel/tool";
import { saveAbelModels } from "@/server/admin-actions";

/*
 * The admin dashboard's Abel tab: which models Abel uses on the AI service he's running on, picked
 * from that service's own list. On OpenRouter up to three, tried in order, grouped by company with
 * their prices; on DeepSeek or Gemini one. A text field instead when the list can't be loaded.
 * Then every tool Abel has, look-ups and changes, with who may use each.
 */

const FROM: Record<ModelSource, string> = { admin: "chosen here", env: "from ABEL_MODEL", default: "the defaults" };
const LABELS = ["Model", "If it’s busy", "Then"];

const AREA_LABEL = Object.fromEntries(AREAS.map((a) => [a.key, a.label]));

/** Who a tool is offered to, as the members' access has it. */
function whoMay(t: AbelTool) {
  if (t.needs === "anyone") return "Anyone";
  if (t.needs === "admin") return "Group admins";
  return `${AREA_LABEL[t.needs.area]}: ${t.needs.level === "edit" ? "change" : "view"}`;
}

function ToolTable({ title, tools }: { title: string; tools: AbelTool[] }) {
  return (
    <>
      <h3 className="mt-4 mb-2 text-sm font-medium">
        {title} ({tools.length})
      </h3>
      <div className="overflow-x-auto">
        <table className="data dense">
          <thead>
            <tr>
              <th>Tool</th>
              <th>What it does</th>
              <th>Who can use it</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.name} data-filter={`${t.name} ${t.description} ${whoMay(t)}`}>
                <td className="font-mono text-xs whitespace-nowrap">{t.name}</td>
                <td className="text-sm">{t.description}</td>
                <td className="text-sm whitespace-nowrap">{whoMay(t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AbelTools() {
  return (
    <Card title={`Tools (${ABEL_TOOLS.length})`}>
      <FilterList placeholder="Find a tool">
        <ToolTable title="Look-ups" tools={ABEL_TOOLS.filter((t) => !t.write)} />
        <ToolTable title="Changes" tools={ABEL_TOOLS.filter((t) => t.write)} />
      </FilterList>
    </Card>
  );
}

const dollars = (n: number | null) => (n === null ? "?" : `$${n}`);

/** OpenRouter's models by company ("Anthropic: Claude Haiku 5.5" → Anthropic, Claude Haiku 5.5), both A to Z. */
function byCompany(models: ServiceModel[]) {
  const groups = new Map<string, (ServiceModel & { model: string })[]>();
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
      <div className="space-y-6">
        <Card title="Abel">
          <Empty>Abel has no AI service set up.</Empty>
        </Card>
        <AbelTools />
      </div>
    );
  const openRouter = provider === "openrouter";
  const [saved, inUse, catalog] = await Promise.all([savedModels(provider), abelModels(provider), serviceModels(provider)]);
  const fallbackList = fallbackModels(provider).models;
  const slots = openRouter ? MAX_MODELS : 1;

  return (
    <div className="space-y-6">
      <Card title="Abel">
        <p className="mb-4 text-sm">
          Running on {SERVICE_NAMES[provider]}: <span className="font-medium">{inUse.models.join(", then ")}</span> <span className="text-muted">({FROM[inUse.from]})</span>
        </p>
        {!catalog && <Callout>Couldn’t load {SERVICE_NAMES[provider]}’s list of models.</Callout>}
        <ActionForm action={saveAbelModels} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: slots }, (_, i) => (
              <Field key={i} label={LABELS[i]}>
                {catalog ? (
                  // Keyed by the saved model, so it shows the new one after a save (the form resets to what it loaded with).
                  <select key={saved[i] ?? ""} name="model" defaultValue={saved[i] ?? ""}>
                    <option value="">{openRouter ? "None" : `Default (${fallbackList[0]})`}</option>
                    {saved[i] && !catalog.some((m) => m.id === saved[i]) && (
                      <option value={saved[i]}>
                        {saved[i]} (no longer on {SERVICE_NAMES[provider]})
                      </option>
                    )}
                    {openRouter
                      ? byCompany(catalog).map(([company, models]) => (
                          <optgroup key={company} label={company}>
                            {models.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.model} · {dollars(m.inPerMillion)} in, {dollars(m.outPerMillion)} out
                              </option>
                            ))}
                          </optgroup>
                        ))
                      : catalog.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name === m.id ? m.id : `${m.name} (${m.id})`}
                          </option>
                        ))}
                  </select>
                ) : (
                  <input name="model" defaultValue={saved[i] ?? ""} autoComplete="off" spellCheck={false} />
                )}
              </Field>
            ))}
          </div>
          {openRouter && catalog && <p className="text-xs text-muted">Prices are per million tokens.</p>}
          {(openRouter || !catalog) && <p className="text-xs text-muted">With every field empty, Abel uses {fallbackList.join(", then ")}.</p>}
          <SaveWhenChanged>
            <SubmitButton size="sm">Save</SubmitButton>
          </SaveWhenChanged>
        </ActionForm>
      </Card>
      <AbelTools />
    </div>
  );
}
