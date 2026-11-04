import { ArrowsClockwiseIcon, HardDrivesIcon, PlugsConnectedIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toErrorMessage } from "../../shared/api-client";
import type { ConnectionTestResult, Host, Workspace } from "../../shared/api-types";
import { ErrorBox } from "../../shared/components/ErrorBox";
import { StatusLabel } from "../../shared/components/StatusLabel";
import { boxClass, boxHeaderClass, dangerButton, secondaryButton } from "../../shared/components/styles";
import { formatTimeAgo } from "../../shared/format";
import { HostChecklist, summarizeCheck } from "./HostChecklist";
import { TemplateSection } from "./TemplateGuide";
import { hostsApi } from "./hosts-api";

function summarizeWorkspaces(workspaces: Workspace[]): string {
  if (workspaces.length === 0) return "No workspaces yet. Remove is allowed.";
  const names = workspaces.map((workspace) => workspace.name).join(", ");
  return `${workspaces.length} ${workspaces.length === 1 ? "workspace" : "workspaces"}: ${names}`;
}

export function HostCard({
  host,
  workspaces,
  workspacesError,
  onChanged,
}: {
  host: Host;
  workspaces: Workspace[] | undefined;
  workspacesError: string | undefined;
  onChanged: () => void;
}) {
  const [testResult, setTestResult] = useState<ConnectionTestResult>();
  const [isTesting, setIsTesting] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isStartingPrepare, setIsStartingPrepare] = useState(false);
  const [actionError, setActionError] = useState<{ title: string; message: string }>();

  async function runAction(title: string, action: () => Promise<void>, setBusy: (isBusy: boolean) => void) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
    } catch (caught) {
      setActionError({ title, message: toErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  const testConnection = () =>
    runAction(
      `Could not reach ${host.baseUrl}`,
      async () => {
        setTestResult(await hostsApi.testConnection(host.id));
      },
      setIsTesting,
    );
  const runChecks = () =>
    runAction(
      "Checks did not run",
      async () => {
        await hostsApi.checkSavedHost(host.id);
        onChanged();
      },
      setIsChecking,
    );
  const prepareHost = () =>
    runAction(
      `Could not start preparing ${host.name}`,
      async () => {
        await hostsApi.prepare(host.id);
        onChanged();
      },
      setIsStartingPrepare,
    );
  const removeHost = () =>
    runAction(
      `Could not remove ${host.name}`,
      async () => {
        setIsConfirmingRemove(false);
        await hostsApi.delete(host.id);
        onChanged();
      },
      setIsRemoving,
    );

  const check = host.lastCheck;
  const summary = check ? summarizeCheck(check) : undefined;

  return (
    <article className={boxClass} aria-labelledby={`host-${host.id}`}>
      <div className={`${boxHeaderClass} items-start`}>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <HardDrivesIcon size={20} className="text-muted" aria-hidden="true" />
            <h2 id={`host-${host.id}`} className="m-0 text-base font-semibold">
              {host.name}
            </h2>
            {summary ? <StatusLabel tone={summary.tone === "danger" ? "danger" : "success"}>{summary.label}</StatusLabel> : <StatusLabel tone="muted">Not checked</StatusLabel>}
          </div>
          <span className="truncate font-mono text-xs text-muted">{host.baseUrl}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {check && summary && (
            <span className="text-xs text-muted">
              {summary.text}, {formatTimeAgo(check.checkedAt)}
            </span>
          )}
          <button type="button" className={secondaryButton} onClick={() => void runChecks()} disabled={isChecking}>
            <ArrowsClockwiseIcon size={16} aria-hidden="true" />
            {isChecking ? "Checking" : check ? "Re-run checks" : "Run checks"}
          </button>
        </div>
      </div>
      {check ? (
        <HostChecklist check={check} />
      ) : (
        <p className="m-0 px-4 py-4 text-sm text-muted">Not checked yet. Run the checks to see if this host can run workspaces.</p>
      )}
      <TemplateSection host={host} isStartingPrepare={isStartingPrepare} onPrepare={() => void prepareHost()} />
      {(actionError || (testResult && !testResult.ok)) && (
        <div className="border-t border-line-muted px-4 py-3">
          {actionError ? (
            <ErrorBox title={actionError.title}>{actionError.message}</ErrorBox>
          ) : (
            testResult && !testResult.ok && <ErrorBox title={`Could not reach ${host.baseUrl}`}>{testResult.message}</ErrorBox>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3">
        <p className="m-0 text-sm text-muted">
          {workspaces ? summarizeWorkspaces(workspaces) : workspacesError ? "Workspace count unavailable" : "Counting workspaces"}
          {testResult?.ok && <span className="ml-3 text-success">Connected, Proxmox {testResult.version}</span>}
        </p>
        {isConfirmingRemove ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Remove {host.name}?</span>
            <button type="button" className={dangerButton} onClick={() => void removeHost()} disabled={isRemoving}>
              {isRemoving ? "Removing" : "Remove"}
            </button>
            <button type="button" className={secondaryButton} onClick={() => setIsConfirmingRemove(false)} disabled={isRemoving}>
              Keep host
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button type="button" className={secondaryButton} onClick={() => void testConnection()} disabled={isTesting}>
              <PlugsConnectedIcon size={16} aria-hidden="true" />
              {isTesting ? "Testing" : "Test connection"}
            </button>
            <button type="button" className={dangerButton} onClick={() => setIsConfirmingRemove(true)}>
              Remove
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
