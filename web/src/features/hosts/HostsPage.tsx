import { HardDrivesIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import { api } from "../../shared/api-client";
import { ErrorBox } from "../../shared/components/ErrorBox";
import { LoadingText } from "../../shared/components/LoadingText";
import { useResource } from "../../shared/use-resource";
import { AddHostForm } from "./AddHostForm";
import { HostCard } from "./HostCard";
import { useHosts } from "./HostsContext";

export function HostsPage() {
  const hosts = useHosts();
  const workspaces = useResource(api.listWorkspaces, "workspaces");
  const isPreparing = hosts.data?.some((host) => host.templateStatus === "preparing") ?? false;
  const reloadHosts = hosts.reload;

  useEffect(() => {
    if (!isPreparing) return;
    const timer = window.setInterval(() => void reloadHosts(), 3000);
    return () => window.clearInterval(timer);
  }, [isPreparing, reloadHosts]);

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-10 pt-6 pb-10">
      <div>
        <h1 className="m-0 text-2xl font-semibold">Hosts</h1>
        <p className="mt-1 mb-0 text-sm text-muted">Proxmox servers that run your workspaces.</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-6">
        <section className="flex min-w-0 flex-col gap-4" aria-label="Hosts">
          {hosts.isLoading ? (
            <LoadingText>Loading hosts</LoadingText>
          ) : hosts.error && !hosts.data ? (
            <ErrorBox title="Could not load hosts">
              {hosts.error}{" "}
              <button type="button" onClick={() => void hosts.reload()} className="focus-ring cursor-pointer rounded-sm bg-transparent p-0 font-semibold text-accent">
                Try again
              </button>
            </ErrorBox>
          ) : (hosts.data ?? []).length === 0 ? (
            <div className="flex flex-col items-center rounded-md border border-line px-6 py-10 text-center">
              <HardDrivesIcon size={32} className="text-muted" aria-hidden="true" />
              <p className="mt-4 mb-0 text-base font-semibold">No hosts yet</p>
              <p className="mt-2 mb-0 text-sm text-muted">Add your Proxmox server with the form. It is checked before it is saved.</p>
            </div>
          ) : (
            (hosts.data ?? []).map((host) => (
              <HostCard
                key={host.id}
                host={host}
                workspaces={workspaces.data?.filter((workspace) => workspace.hostId === host.id)}
                workspacesError={workspaces.error}
                onChanged={() => void hosts.reload()}
              />
            ))
          )}
        </section>
        <AddHostForm onAdded={() => void hosts.reload()} />
      </div>
    </div>
  );
}
