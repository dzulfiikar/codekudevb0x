import { CubeIcon, GearSixIcon, HardDrivesIcon, StackIcon, type Icon } from "@phosphor-icons/react";
import { useContext, useEffect } from "react";
import { HostsContext } from "./features/hosts/HostsContext";
import { hostsApi } from "./features/hosts/hosts-api";
import { HostsPage } from "./features/hosts/HostsPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { NewWorkspacePage } from "./features/workspaces/NewWorkspacePage";
import { WorkspaceDetailPage } from "./features/workspaces/WorkspaceDetailPage";
import { WorkspacesPage } from "./features/workspaces/WorkspacesPage";
import { workspacesApi } from "./features/workspaces/workspaces-api";
import { StatusLabel } from "./shared/components/StatusLabel";
import { Link, navigate, usePath } from "./shared/router";
import { useResource } from "./shared/use-resource";

export function App() {
  const path = usePath();
  const hosts = useResource(hostsApi.list, "hosts");

  useEffect(() => {
    if (path === "/") navigate("/workspaces", { replace: true });
  }, [path]);

  return (
    <HostsContext value={hosts}>
      <TopBar path={path} />
      <main>{renderPage(path)}</main>
    </HostsContext>
  );
}

function renderPage(path: string) {
  if (path === "/" || path === "/workspaces") return <WorkspacesPage />;
  if (path === "/workspaces/new") return <NewWorkspacePage />;
  if (path === "/hosts") return <HostsPage />;
  if (path === "/settings") return <SettingsPage />;
  const workspaceMatch = /^\/workspaces\/([^/]+)$/.exec(path);
  if (workspaceMatch) return <WorkspaceDetailPage key={workspaceMatch[1]} workspaceId={decodeURIComponent(workspaceMatch[1])} />;
  return (
    <div className="px-10 py-9">
      <h1 className="m-0 text-2xl font-semibold">Page not found</h1>
      <p className="mt-3 text-sm text-muted">
        Nothing lives at <span className="font-mono">{path}</span>.{" "}
        <Link href="/workspaces" className="focus-ring rounded-sm text-accent">
          Go to workspaces
        </Link>
      </p>
    </div>
  );
}

const navItems: { href: string; label: string; icon: Icon; counter?: "workspaces" | "hosts" }[] = [
  { href: "/workspaces", label: "Workspaces", icon: StackIcon, counter: "workspaces" },
  { href: "/hosts", label: "Hosts", icon: HardDrivesIcon, counter: "hosts" },
  { href: "/settings", label: "Settings", icon: GearSixIcon },
];

function TopBar({ path }: { path: string }) {
  const hosts = useContext(HostsContext);
  const workspaces = useResource(workspacesApi.list, `workspaces-${path}`);
  const counts = { workspaces: workspaces.data?.length, hosts: hosts?.data?.length };
  return (
    <header className="border-b border-line bg-inset">
      <div className="flex h-14 items-center justify-between px-6">
        <Link href="/workspaces" className="focus-ring flex items-center gap-3 rounded-md text-lg font-semibold text-text no-underline">
          <CubeIcon size={24} aria-hidden="true" />
          CodekuDevB0x
        </Link>
        <HostStatus />
      </div>
      <nav aria-label="Main" className="flex items-end gap-2 px-4">
        {navItems.map((item) => {
          const isCurrent = path === item.href || path.startsWith(`${item.href}/`);
          const count = item.counter ? counts[item.counter] : undefined;
          const ItemIcon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent ? "page" : undefined}
              className={`focus-ring -mb-px flex items-center gap-2 border-b-2 px-2 pt-1 pb-3 text-sm no-underline ${
                isCurrent ? "border-tab font-semibold text-text" : "border-transparent text-text hover:border-line"
              }`}
            >
              <ItemIcon size={16} className="text-muted" aria-hidden="true" />
              {item.label}
              {count !== undefined && (
                <span className="rounded-full bg-line px-1.5 text-xs leading-[18px] font-medium text-text" aria-label={`${count}`}>
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

function HostStatus() {
  const hosts = useContext(HostsContext);
  if (!hosts || hosts.isLoading) return <span className="text-xs text-muted">Checking hosts</span>;
  if (hosts.error) return <span className="text-xs text-danger">Host list unavailable</span>;
  const list = hosts.data ?? [];
  if (list.length === 0) return <span className="text-xs text-muted">No host added</span>;
  if (list.length > 1) return <span className="text-xs text-muted">{list.length} hosts</span>;
  const [host] = list;
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="font-mono text-muted">{host.name}</span>
      {host.version && <StatusLabel tone="muted">Proxmox {host.version.split(".").slice(0, 2).join(".")}</StatusLabel>}
    </span>
  );
}
