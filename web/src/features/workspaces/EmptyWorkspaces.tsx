import { CheckCircleIcon, CircleDashedIcon, PlusIcon, StackIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { ErrorBox } from "../../shared/components/ErrorBox";
import { PageLayout } from "../../shared/components/PageLayout";
import { primaryButton, secondaryButton } from "../../shared/components/styles";
import { Link } from "../../shared/router";
import { useResource } from "../../shared/use-resource";
import { useHosts } from "../hosts/HostsContext";
import { settingsApi } from "../settings/settings-api";

export function EmptyWorkspaces() {
  const hosts = useHosts();
  const settings = useResource(settingsApi.get, "settings");
  const hostList = hosts.data ?? [];
  const readyHost = hostList.find((host) => host.templateStatus === "ready");
  const hasKey = settings.data?.geminiApiKeySource === "database";
  const canCreate = readyHost !== undefined && hasKey;

  return (
    <PageLayout title="Workspaces">
      {hosts.error && !hosts.data && <ErrorBox title="Could not load Proxmox hosts">{hosts.error}</ErrorBox>}
      <section className="flex flex-col items-center rounded-md border border-line px-6 py-10 text-center">
        <StackIcon size={32} className="text-muted" aria-hidden="true" />
        <h2 className="mt-4 mb-0 text-xl font-semibold">No workspaces yet</h2>
        <p className="mt-2 mb-6 text-sm text-muted">A workspace is a VM on your Proxmox host with your repos running in dev mode.</p>
        <ul className="m-0 w-full max-w-[520px] list-none rounded-md border border-line p-0 text-left">
          <SetupItem
            isDone={hostList.length > 0}
            title="Proxmox host"
            detail={hostList.length > 0 ? `${hostList.map((host) => host.name).join(", ")} added` : "Not added yet"}
            action={hostList.length === 0 && <SetupLink href="/hosts">Add host</SetupLink>}
          />
          <SetupItem
            isDone={readyHost !== undefined}
            title="Template"
            detail={
              readyHost
                ? `Template ${readyHost.templateVmid} ready on ${readyHost.name}`
                : hostList.some((host) => host.templateStatus === "preparing")
                  ? "Building now"
                  : "Not built yet"
            }
            action={hostList.length > 0 && !readyHost && <SetupLink href="/hosts">Prepare host</SetupLink>}
          />
          <SetupItem
            isDone={hasKey}
            title="Gemini API key"
            detail={settings.isLoading ? "Checking" : settings.error ? "Could not check" : hasKey ? "Saved" : "Not set"}
            action={!hasKey && <SetupLink href="/settings">Open Settings</SetupLink>}
          />
        </ul>
        {canCreate ? (
          <Link href="/workspaces/new" className={`${primaryButton} mt-5 no-underline`}>
            <PlusIcon size={16} aria-hidden="true" />
            New workspace
          </Link>
        ) : (
          <>
            <button type="button" className={`${primaryButton} mt-5`} disabled aria-describedby="new-workspace-hint">
              <PlusIcon size={16} aria-hidden="true" />
              New workspace
            </button>
            <p id="new-workspace-hint" className="mt-3 mb-0 text-xs text-muted">
              Available once the template and key are ready.
            </p>
          </>
        )}
      </section>
    </PageLayout>
  );
}

function SetupItem({ isDone, title, detail, action }: { isDone: boolean; title: string; detail: string; action: ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-t border-line-muted px-4 py-3 first:border-t-0">
      {isDone ? (
        <CheckCircleIcon size={20} className="shrink-0 text-success" aria-label="Done" />
      ) : (
        <CircleDashedIcon size={20} className="shrink-0 text-muted" aria-label="Not done" />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm">{title}</span>
        <span className="text-xs text-muted">{detail}</span>
      </div>
      {action}
    </li>
  );
}

function SetupLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={`${secondaryButton} no-underline`}>
      {children}
    </Link>
  );
}
