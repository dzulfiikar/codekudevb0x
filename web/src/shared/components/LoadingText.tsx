import type { ReactNode } from "react";

export function LoadingText({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="m-0 text-sm text-muted">
      {children}
    </p>
  );
}
