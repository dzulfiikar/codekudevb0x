import { ApiError, post, request } from "../../shared/api-client";
import type { ConnectionTestResult, CreateHostInput, Host, HostCheck } from "../../shared/api-types";

export const hostsApi = {
  list: () => request<Host[]>("/hosts"),
  create: (host: CreateHostInput) => post<Host>("/hosts", host),
  delete: (id: string) => request<void>(`/hosts/${id}`, { method: "DELETE" }),
  testConnection: (id: string) => post<ConnectionTestResult>(`/hosts/${id}/test`),
  checkUnsavedHost: (host: Omit<CreateHostInput, "name">) => post<HostCheck>("/hosts/check", host),
  checkSavedHost: (id: string) => post<HostCheck>(`/hosts/${id}/check`),
  prepare: (id: string) => post<void>(`/hosts/${id}/prepare`),
};

export function findHostCheck(error: unknown): HostCheck | undefined {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") return undefined;
  const { check } = error.body as { check?: HostCheck };
  return check && Array.isArray(check.checks) ? check : undefined;
}
