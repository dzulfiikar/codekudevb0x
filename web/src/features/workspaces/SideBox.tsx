import type { ReactNode } from "react";
import { boxClass, boxHeaderClass } from "../../shared/components/styles";

export function SideBox({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={boxClass} aria-label={title}>
      <div className={boxHeaderClass}>
        <h2 className="m-0 text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </section>
  );
}
