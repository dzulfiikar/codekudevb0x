import type { ReactNode } from "react";

export type LabelTone = "success" | "attention" | "danger" | "muted";

const labelToneClass: Record<LabelTone, string> = {
  success: "border-success text-success",
  attention: "border-warn text-warn",
  danger: "border-danger text-danger",
  muted: "border-line text-muted",
};

export function StatusLabel({ tone, children }: { tone: LabelTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 text-xs leading-[18px] font-medium whitespace-nowrap ${labelToneClass[tone]}`}>
      {children}
    </span>
  );
}
