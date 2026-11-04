import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState, type RefObject } from "react";
import { toErrorMessage } from "../../shared/api-client";
import type { Workspace } from "../../shared/api-types";
import { ErrorBox } from "../../shared/components/ErrorBox";
import { StatusLabel } from "../../shared/components/StatusLabel";
import { dangerButton, primaryButton, secondaryButton } from "../../shared/components/styles";
import { Link, navigate } from "../../shared/router";
import { useHosts } from "../hosts/HostsContext";
import { workspaceLabel } from "./workspace-status";
import { workspacesApi } from "./workspaces-api";

export function WorkspaceHeader({
  workspace,
  addProjectButtonRef,
  onAddProject,
}: {
  workspace: Workspace;
  addProjectButtonRef: RefObject<HTMLButtonElement | null>;
  onAddProject: () => void;
}) {
  const hosts = useHosts();
  const hostName = hosts.data?.find((host) => host.id === workspace.hostId)?.name;
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const label = workspaceLabel(workspace.status);

  async function deleteWorkspace() {
    setIsDeleting(true);
    setDeleteError(undefined);
    try {
      await workspacesApi.delete(workspace.id);
      navigate("/workspaces");
    } catch (caught) {
      setDeleteError(toErrorMessage(caught));
      setIsDeleting(false);
      setIsConfirmingDelete(false);
    }
  }

  const meta = [
    workspace.vmid === null ? "no VM yet" : `VM ${workspace.vmid}`,
    workspace.ip ?? "no IP yet",
    hostName,
    `${workspace.projects.length} ${workspace.projects.length === 1 ? "project" : "projects"}`,
  ].filter(Boolean);

  return (
    <>
      <nav aria-label="Breadcrumb" className="flex gap-2 text-sm">
        <Link href="/workspaces" className="focus-ring rounded-sm text-accent no-underline hover:underline">
          Workspaces
        </Link>
        <span className="text-muted" aria-hidden="true">
          /
        </span>
        <span className="font-semibold" aria-current="page">
          {workspace.name}
        </span>
      </nav>
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="m-0 text-2xl font-semibold">{workspace.name}</h1>
            <StatusLabel tone={label.tone}>{label.text}</StatusLabel>
          </div>
          <div className="flex flex-wrap gap-x-4 font-mono text-xs text-muted">
            {meta.map((value) => (
              <span key={value}>{value}</span>
            ))}
          </div>
        </div>
        {isConfirmingDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Stop and delete this VM with all its projects?</span>
            <button type="button" className={dangerButton} onClick={() => void deleteWorkspace()} disabled={isDeleting}>
              {isDeleting ? "Deleting" : "Delete"}
            </button>
            <button type="button" className={secondaryButton} onClick={() => setIsConfirmingDelete(false)} disabled={isDeleting}>
              Keep workspace
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {workspace.status !== "deleting" && (
              <button type="button" className={dangerButton} onClick={() => setIsConfirmingDelete(true)}>
                <TrashIcon size={16} aria-hidden="true" />
                Delete workspace
              </button>
            )}
            {workspace.status === "running" ? (
              <button ref={addProjectButtonRef} type="button" className={primaryButton} onClick={onAddProject}>
                <PlusIcon size={16} aria-hidden="true" />
                Add project
              </button>
            ) : (
              workspace.status !== "failed" &&
              workspace.status !== "deleting" && <span className="text-xs text-muted">Add projects once the VM is running</span>
            )}
          </div>
        )}
      </div>
      {deleteError && <ErrorBox title={`Could not delete ${workspace.name}`}>{deleteError}</ErrorBox>}
    </>
  );
}
