export type CommandResult = { exitCode: number; stdout: string; stderr: string };

export const quoteForShell = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
