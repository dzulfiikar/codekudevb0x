import type { ReactNode } from "react";

export function PageLayout({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-10 pt-6 pb-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-semibold">{title}</h1>
          {description && <p className="mt-1 mb-0 text-sm text-muted">{description}</p>}
        </div>
        {action && <div className="pt-2">{action}</div>}
      </div>
      {children}
    </div>
  );
}
