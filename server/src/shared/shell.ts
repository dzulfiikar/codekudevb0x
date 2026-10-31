export type CommandResult = { exitCode: number; stdout: string; stderr: string };

export const quoteForShell = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
