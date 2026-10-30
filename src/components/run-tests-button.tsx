"use client";

import { useFormStatus } from "react-dom";
import { buttonClass } from "./ui";

/** Runs tests from the admin dashboard's Tests tab; says so while they run (a full run takes a minute or so). */
export function RunTestsButton({ children, variant = "secondary", size = "sm" }: { children: React.ReactNode; variant?: "primary" | "secondary"; size?: "sm" | "md" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, size)}>
      {pending ? "Running…" : children}
    </button>
  );
}
