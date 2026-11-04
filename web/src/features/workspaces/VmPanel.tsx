import type { Event, Workspace } from "../../shared/api-types";
import { secondaryButton } from "../../shared/components/styles";
import { useHosts } from "../hosts/HostsContext";
import { ConnectBox } from "./ConnectBox";
import { SetupSteps } from "./SetupSteps";
import { SideBox } from "./SideBox";
import { workspaceSummary } from "./workspace-status";

export function VmPanel({
  workspace,
  events,
  isSetupSelected,
  onShowSetupLog,
}: {
  workspace: Workspace;
  events: Event[];
  isSetupSelected: boolean;
  onShowSetupLog: () => void;
}) {
  const hosts = useHosts();
  const host = hosts.data?.find((candidate) => candidate.id === workspace.hostId);
  const agentNames = workspace.agentClis.map((agent) => (agent === "antigravity" ? "Antigravity CLI" : agent === "claude" ? "Claude Code" : agent));
  const facts: [string, string][] = [
    ["Host", host ? `${host.name} (${host.node})` : "unknown host"],
    ["Template", host ? String(host.templateVmid) : "unknown"],
    ["Size", workspaceSummary(workspace)],
    ["Agent CLI", agentNames.length > 0 ? agentNames.join(", ") : "none"],
    ["GitHub token", workspace.hasGithubToken ? "saved, encrypted" : "none"],
  ];

  return (
    <aside className="flex flex-col gap-4" aria-label="VM">
      {workspace.ip && <ConnectBox workspace={workspace} ip={workspace.ip} />}
      <SideBox title="About this VM">
        <dl className="m-0 flex flex-col gap-3">
          {facts.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="m-0 text-right font-mono text-xs leading-5">{value}</dd>
            </div>
          ))}
        </dl>
      </SideBox>
      <SideBox
        title="Setup"
        action={
          <button type="button" aria-pressed={isSetupSelected} onClick={onShowSetupLog} className={secondaryButton}>
            {isSetupSelected ? "Showing log" : "Show log"}
          </button>
        }
      >
        <SetupSteps workspace={workspace} events={events} />
      </SideBox>
    </aside>
  );
}
