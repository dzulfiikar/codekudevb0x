import { createContext, useContext } from "react";
import type { Host } from "../../shared/api-types";
import type { Resource } from "../../shared/use-resource";

export const HostsContext = createContext<Resource<Host[]> | undefined>(undefined);

export function useHosts(): Resource<Host[]> {
  const hosts = useContext(HostsContext);
  if (!hosts) throw new Error("useHosts needs HostsContext");
  return hosts;
}
