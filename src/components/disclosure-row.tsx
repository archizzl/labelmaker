"use client";

import { type ReactNode, useState } from "react";
import { buttonClass } from "./ui";

/**
 * A row of Disclosure-style buttons sharing one panel below them: opening one doesn't move the
 * others onto a new line, as separate Disclosures do (an open one is as wide as its panel). One
 * open at a time. Each panel sits in a <details>, so a form that closes its panel when saved still does.
 */
export function DisclosureRow({
  panels,
  before,
  after,
  className = "",
}: {
  panels: { label: string; content: ReactNode }[];
  /** Other buttons in the row (a link, a delete button), before or after the panels' ones. */
  before?: ReactNode;
  after?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className={className}>
      <div className="flex flex-wrap items-start gap-2">
        {before}
        {panels.map((p, i) => (
          <button
            key={p.label}
            type="button"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
            className={`${buttonClass("secondary", "sm")} ${open === i ? "!border-muted" : ""}`}
          >
            {p.label}
          </button>
        ))}
        {after}
      </div>
      {panels.map((p, i) => (
        <details key={p.label} open={open === i} onToggle={(e) => !e.currentTarget.open && open === i && setOpen(null)} className={open === i ? "" : "hidden"}>
          <summary className="hidden">{p.label}</summary>
          <div className="mt-3 border border-border bg-surface-2 p-4 text-left">{p.content}</div>
        </details>
      ))}
    </div>
  );
}
