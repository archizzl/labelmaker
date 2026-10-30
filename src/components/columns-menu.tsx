"use client";

import { useEffect, useRef, useState } from "react";
import { LIST_COLUMNS, type ListId } from "@/lib/list-columns";
import { saveHiddenColumns } from "@/server/list-column-actions";

const EVENT = "list-columns";

/**
 * "Columns", next to a list of sales' filters: a checkbox for each column to show or hide, kept for
 * this person. It hides them itself, with a style rule for the list's cells (see src/lib/list-columns.ts),
 * and keeps any other copy of the same list on the page in step.
 */
export function ColumnsMenu({
  list,
  hidden: saved,
  without = [],
  className = "",
}: {
  list: ListId;
  hidden: string[];
  /** Columns this copy of the list doesn't have (they aren't offered). */
  without?: string[];
  className?: string;
}) {
  const [hidden, setHidden] = useState(saved);
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const follow = (e: Event) => {
      const d = (e as CustomEvent<{ list: string; hidden: string[] }>).detail;
      if (d.list === list) setHidden(d.hidden);
    };
    // Clicking anywhere else closes the menu.
    const close = (e: MouseEvent) => {
      if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false;
    };
    window.addEventListener(EVENT, follow);
    document.addEventListener("click", close);
    return () => {
      window.removeEventListener(EVENT, follow);
      document.removeEventListener("click", close);
    };
  }, [list]);

  const toggle = (key: string, show: boolean) => {
    const next = show ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { list, hidden: next } }));
    // (Not kept while viewing as someone else: nothing can be changed then.)
    saveHiddenColumns(list, next).catch(() => {});
  };

  const offered = LIST_COLUMNS[list].filter((c) => !without.includes(c.key));
  const hiddenHere = hidden.filter((k) => offered.some((c) => c.key === k)).length;
  const css = hidden.map((k) => `[data-cols="${list}"] [data-col="${k}"]{display:none}`).join("");
  return (
    <>
      {css && <style>{css}</style>}
      <details ref={menu} className={`relative ${className}`}>
        <summary className="cursor-pointer text-sm text-link">Columns{hiddenHere ? `` : ""}</summary>
        <div className="absolute right-0 z-20 mt-1 w-52 space-y-1.5 rounded-sm border border-border bg-surface p-3 shadow-lg">
          {offered.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={!hidden.includes(c.key)} onChange={(e) => toggle(c.key, e.target.checked)} />
              {c.label}
            </label>
          ))}
        </div>
      </details>
    </>
  );
}
