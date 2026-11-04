import type { ReactNode } from "react";

export function ErrorBox({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-md border border-danger/60 bg-danger/10 px-4 py-3">
      <p className="m-0 text-sm font-semibold text-danger">{title}</p>
      {children && <div className="mt-1 text-xs leading-5 text-text">{children}</div>}
    </div>
  );
}
