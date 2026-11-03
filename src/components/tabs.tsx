import Link from "next/link";
import type { ReactNode } from "react";

export type TabItem = {
  href: string;
  label: ReactNode;
  active: boolean;
  /** After the label: a number or word shows as a small muted count; anything else is shown as given. */
  badge?: ReactNode;
};

/**
 * The one tab bar for a page's sections: underlined links over a hairline rule. On a narrow screen
 * the row scrolls sideways inside itself, never the page.
 */
export function Tabs({
  items,
  label,
  lead,
  children,
  scroll,
  className = "mb-6",
}: {
  items: TabItem[];
  /** What the tabs choose between, for screen readers. */
  label: string;
  /** A word before the tabs (Payouts' "pay:"). */
  lead?: ReactNode;
  /** More controls after the tabs (a list to pick from, say). */
  children?: ReactNode;
  /** Passed to each link: false keeps the scroll position. */
  scroll?: boolean;
  /** Spacing around the bar. */
  className?: string;
}) {
  return (
    <nav className={`flex max-w-full items-end gap-6 overflow-x-auto border-b border-border text-sm ${className}`} aria-label={label}>
      {lead && <span className="pb-1 whitespace-nowrap text-muted">{lead}</span>}
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          scroll={scroll}
          aria-current={t.active ? "page" : undefined}
          className={`border-b-2 pb-1 whitespace-nowrap hover:no-underline ${t.active ? "border-accent font-bold text-text" : "border-transparent text-muted hover:text-text"}`}
        >
          {t.label}
          {t.badge !== undefined &&
            t.badge !== null &&
            t.badge !== false &&
            (typeof t.badge === "string" || typeof t.badge === "number" ? <span className="ml-1.5 text-xs font-normal text-muted">{t.badge}</span> : t.badge)}
        </Link>
      ))}
      {children && <div className="pb-1">{children}</div>}
    </nav>
  );
}
