const buttonBase =
  "focus-ring inline-flex items-center justify-center gap-2 rounded-md border px-4 py-[5px] text-sm font-medium leading-5 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60";
export const primaryButton = `${buttonBase} border-white/10 bg-success-emphasis text-white hover:brightness-110`;
export const secondaryButton = `${buttonBase} border-line bg-button text-text hover:bg-line-muted`;
export const dangerButton = `${buttonBase} border-line bg-button text-danger-button hover:border-danger hover:bg-danger/10`;
export const inputClass =
  "focus-ring w-full rounded-md border border-line bg-bg px-3 py-[5px] leading-5 font-mono text-sm text-text placeholder:text-muted aria-invalid:border-danger focus-visible:border-accent";
export const boxClass = "overflow-hidden rounded-md border border-line";
export const boxHeaderClass = "flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3";
export const selectClass = `${inputClass} select-chevron`;
