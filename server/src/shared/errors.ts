import type { HostCheck } from "./api-types.js";

export class NotFoundError extends Error {}

export class ConflictError extends Error {}

export class InvalidInputError extends Error {}

export class HostNotReadyError extends InvalidInputError {
  constructor(readonly check: HostCheck) {
    const failingLabels = check.checks.filter((item) => item.status === "fail").map((item) => item.label);
    super(`This host is not ready: ${failingLabels.join(", ")}`);
  }
}

export const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
