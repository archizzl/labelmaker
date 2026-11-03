import { ActionForm, SaveWhenChanged, SubmitButton } from "@/components/client";
import { Field } from "@/components/ui";
import type { schema } from "@/db";
import { savePersonForm } from "@/server/actions";

type Person = typeof schema.people.$inferSelect;

/**
 * A person's details (the Directory's person form, and a band page's People tab). `labelOnly`: the
 * label's own notes about them, and where they're paid, which a band's own account doesn't change
 * (src/server/actions.ts, payDetails).
 */
export function PersonFields({ person, labelOnly = true }: { person?: Person; labelOnly?: boolean }) {
  return (
    <ActionForm action={savePersonForm} className="grid gap-4 sm:grid-cols-2">
      {person && <input type="hidden" name="id" value={person.id} />}
      <Field label="Name">
        <input name="name" required defaultValue={person?.name} />
      </Field>
      {labelOnly && (
        <>
          <Field label="PayPal email">
            <input name="email" type="email" defaultValue={person?.email ?? ""} />
          </Field>
          <Field label="PayPal.me handle">
            <input name="paypalMe" defaultValue={person?.paypalMe ?? ""} />
          </Field>
          <Field label="Venmo username" hint="US only.">
            <input name="venmo" defaultValue={person?.venmo ?? ""} placeholder="@yourname" />
          </Field>
          <Field label="Cash App $cashtag">
            <input name="cashtag" defaultValue={person?.cashtag ?? ""} placeholder="$yourname" />
          </Field>
          <Field label="Notes">
            <input name="notes" defaultValue={person?.notes ?? ""} />
          </Field>
        </>
      )}
      <div className="sm:col-span-2">
        {person ? (
          <SaveWhenChanged>
            <SubmitButton>Save</SubmitButton>
          </SaveWhenChanged>
        ) : (
          <SubmitButton>Add person</SubmitButton>
        )}
      </div>
    </ActionForm>
  );
}
