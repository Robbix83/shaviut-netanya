"use client";
import { type ReactNode } from "react";

export default function ScrollToWizard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => document.getElementById("check")?.scrollIntoView({ behavior: "smooth" })}
    >
      {children}
    </button>
  );
}
