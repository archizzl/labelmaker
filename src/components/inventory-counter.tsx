"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { changeCount, setIdealCount } from "@/server/inventory-actions";
import { useReadOnly } from "./client";

/**
 * An item's count on the Inventory page: − and + change it by one (quick clicks are saved together),
 * and typing a number sets it. Below it, the ideal count: how many they'd like to have on hand.
 */
export function InventoryCounter({ id, onHand, ideal, low }: { id: number; onHand: number; ideal: number | null; low: boolean }) {
  const readOnly = useReadOnly();
  const [count, setCount] = useState(onHand);
  const [draft, setDraft] = useState(String(onHand));
  const [idealDraft, setIdealDraft] = useState(ideal === null ? "" : String(ideal));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Clicks not saved yet, and the timer that saves them.
  const unsaved = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [waiting, setWaiting] = useState(false);

  // The page refreshed (a save here, or someone else's): show what it has now, unless clicks are
  // waiting to be saved.
  const [seen, setSeen] = useState({ onHand, ideal });
  if (seen.onHand !== onHand || seen.ideal !== ideal) {
    setSeen({ onHand, ideal });
    if (seen.onHand !== onHand && !waiting) {
      setCount(onHand);
      setDraft(String(onHand));
    }
    if (seen.ideal !== ideal) setIdealDraft(ideal === null ? "" : String(ideal));
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const save = (change: { by: number } | { to: number }) =>
    startTransition(async () => {
      const r = await changeCount(id, change);
      setError(r.error ?? null);
      if (r.onHand !== undefined && !unsaved.current) {
        setCount(r.onHand);
        setDraft(String(r.onHand));
      }
    });

  const step = (by: number) => {
    const next = Math.max(0, count + by);
    if (next === count) return;
    unsaved.current += next - count;
    setWaiting(true);
    setCount(next);
    setDraft(String(next));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const by = unsaved.current;
      unsaved.current = 0;
      setWaiting(false);
      if (by) save({ by });
    }, 600);
  };

  const setTo = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(n) || n < 0) return setDraft(String(count));
    if (n === count) return;
    if (timer.current) clearTimeout(timer.current);
    unsaved.current = 0;
    setWaiting(false);
    setCount(n);
    save({ to: n });
  };

  const saveIdeal = () => {
    const n = idealDraft.trim() === "" ? null : Number(idealDraft);
    if (n !== null && (!Number.isInteger(n) || n < 1)) return setIdealDraft(ideal === null ? "" : String(ideal));
    if (n === ideal) return;
    startTransition(async () => {
      const r = await setIdealCount(id, n);
      setError(r.error ?? null);
    });
  };

  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };
  const button = "h-9 w-9 shrink-0 border border-border bg-surface text-lg leading-none hover:bg-surface-2 disabled:opacity-40";

  return (
    <div className={`flex flex-col items-start gap-1.5 md:items-end ${pending ? "opacity-80" : ""}`}>
      <div className="flex items-center">
        <button type="button" className={button} onClick={() => step(-1)} disabled={!!readOnly || count === 0} title={readOnly ?? "Take one off"} aria-label="Take one off">
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={setTo}
          onKeyDown={enter}
          disabled={!!readOnly}
          aria-label="On hand"
          className={`!h-9 !w-16 !border-x-0 !px-1 text-center text-xl font-bold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none ${low ? "!text-warn" : count === 0 ? "!text-muted" : ""}`}
        />
        <button type="button" className={button} onClick={() => step(1)} disabled={!!readOnly} title={readOnly ?? "Add one"} aria-label="Add one">
          +
        </button>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        ideal
        <input
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={idealDraft}
          onChange={(e) => setIdealDraft(e.target.value)}
          onBlur={saveIdeal}
          onKeyDown={enter}
          disabled={!!readOnly}
          placeholder="–"
          className="!h-7 !w-16 !px-1 text-center text-sm tabular-nums"
        />
      </label>
      {ideal !== null && count < ideal && <div className="text-xs text-muted">{ideal - count} short</div>}
      {error && <p className="max-w-48 text-xs text-bad">{error}</p>}
    </div>
  );
}
