import type { ReactNode } from "react";

type FieldProps = {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
};

export function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  error?: string;
  children: (props: FieldProps) => ReactNode;
}) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : undefined, help ? helpId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error && (
        <p id={errorId} className="m-0 text-xs text-danger">
          {error}
        </p>
      )}
      {help && (
        <p id={helpId} className="m-0 text-xs leading-[18px] text-muted">
          {help}
        </p>
      )}
    </div>
  );
}

export function FormSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={`flex flex-col gap-4 ${title ? "border-t border-line pt-5" : ""}`}>
      {title && <h2 className="m-0 text-base font-semibold">{title}</h2>}
      {children}
    </section>
  );
}
