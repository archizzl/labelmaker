"use client";

import { useActionState, useRef } from "react";
import { setInventoryPhoto } from "@/server/inventory-actions";

/**
 * An item's picture on the Inventory page. Without a photo from Bandcamp, clicking it picks a photo
 * from your device, which is uploaded straight away (it replaces one uploaded before).
 */
export function InventoryPhoto({ id, src, editable }: { id: number; src: string | null; editable: boolean }) {
  const [state, action, pending] = useActionState(setInventoryPhoto, null);
  const form = useRef<HTMLFormElement>(null);
  const picture = src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src.replace(/_(2|10|16)\.jpg$/, "_3.jpg")} alt="" loading="lazy" className="h-12 w-12 border border-border bg-surface-2 object-cover" />
  ) : (
    <span className={`flex h-12 w-12 items-center justify-center border border-border bg-surface-2 text-center text-[10px] leading-tight ${editable ? "text-muted" : ""}`}>
      {editable ? "+ photo" : ""}
    </span>
  );
  if (!editable) return picture;
  return (
    <form ref={form} action={action} className="relative h-12 w-12">
      <input type="hidden" name="id" value={id} />
      <label className={`block cursor-pointer hover:opacity-80 ${pending ? "opacity-50" : ""}`} title={src ? "Change the photo" : "Add a photo"}>
        {picture}
        <input
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="sr-only"
          disabled={pending}
          onChange={(e) => {
            if (e.currentTarget.files?.length) form.current?.requestSubmit();
          }}
        />
      </label>
      {state?.error && <p className="absolute top-full left-0 z-10 mt-1 w-48 text-xs text-bad">{state.error}</p>}
    </form>
  );
}
