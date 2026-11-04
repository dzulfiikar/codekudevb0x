import { ArrowsClockwiseIcon, CaretDownIcon, CaretRightIcon, CheckCircleIcon, CopyIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import type { Host } from "../../shared/api-types";
import { ErrorBox } from "../../shared/components/ErrorBox";
import { primaryButton, secondaryButton } from "../../shared/components/styles";
import { useCopy } from "../../shared/use-copy";

function needsTemplateGuide(host: Host): boolean {
  if (host.templateStatus === "missing" || host.templateStatus === "failed") return true;
  const templateCheck = host.lastCheck?.checks.find((check) => check.id === "template");
  return templateCheck !== undefined && templateCheck.status !== "ok";
}

export function TemplateSection({ host, isStartingPrepare, onPrepare }: { host: Host; isStartingPrepare: boolean; onPrepare: () => void }) {
  if (host.templateStatus === "preparing") {
    return (
      <div role="status" className="flex items-center gap-3 border-t border-line px-4 py-3 text-sm">
        <ArrowsClockwiseIcon size={16} className="animate-spin text-warn motion-reduce:animate-none" aria-hidden="true" />
        <span className="font-semibold">Building template {host.templateVmid}</span>
        <span className="text-muted">{host.templateMessage ?? "Starting"}</span>
      </div>
    );
  }
  if (!needsTemplateGuide(host)) return null;
  return (
    <div className="border-t border-line px-4 py-3">
      {host.templateStatus === "failed" && (
        <div className="mb-3">
          <ErrorBox title={`Template ${host.templateVmid} could not be built`}>
            {host.templateMessage ?? "No reason was reported. Try again, or check the task log in Proxmox."}
          </ErrorBox>
        </div>
      )}
      <TemplateGuide host={host} isStartingPrepare={isStartingPrepare} onPrepare={onPrepare} />
    </div>
  );
}

function TemplateGuide({ host, isStartingPrepare, onPrepare }: { host: Host; isStartingPrepare: boolean; onPrepare: () => void }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const commands = [
    `qm create ${host.templateVmid} --name sandbox-ubuntu-2404 --ostype l26 --memory 2048 --cores 2 --cpu host --scsihw virtio-scsi-single --net0 virtio,bridge=${host.bridge} --agent enabled=1 --serial0 socket --vga serial0`,
    `qm set ${host.templateVmid} --scsi0 ${host.vmStorage}:0,import-from=local:import/noble-server-cloudimg-amd64.qcow2 --boot order=scsi0`,
    `qm template ${host.templateVmid}`,
  ].join("\n");
  const { copyState, copy } = useCopy(commands);
  const panelId = `template-guide-${host.id}`;
  const Caret = isExpanded ? CaretDownIcon : CaretRightIcon;

  return (
    <>
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={isExpanded ? panelId : undefined}
        onClick={() => setIsExpanded((current) => !current)}
        className="focus-ring flex cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent p-0 text-sm font-semibold text-text"
      >
        <Caret size={14} className="text-muted" aria-hidden="true" />
        No template yet
      </button>
      {isExpanded && (
        <ol id={panelId} className="m-0 mt-3 flex list-none flex-col gap-4 p-0">
          <GuideStep number={1} title="Prepare host">
            <p className="m-0 text-xs text-muted">Downloads the Ubuntu 24.04 cloud image and builds template {host.templateVmid}.</p>
            <button type="button" className={`${primaryButton} self-start`} onClick={onPrepare} disabled={isStartingPrepare}>
              <DownloadSimpleIcon size={16} aria-hidden="true" />
              {isStartingPrepare ? "Starting" : host.templateStatus === "failed" ? "Try again" : "Prepare host"}
            </button>
          </GuideStep>
          <GuideStep number={2} title="Slow download?">
            <p className="m-0 text-xs text-muted">
              Upload noble-server-cloudimg-amd64.img to local &gt; Import as noble-server-cloudimg-amd64.qcow2, then Prepare host.
            </p>
          </GuideStep>
          <GuideStep number={3} title="Shell">
            <div className="relative">
              <pre className="m-0 overflow-x-auto rounded-md border border-line bg-inset py-3 pr-12 pl-3 font-mono text-xs leading-5 whitespace-pre text-text">
                {commands}
              </pre>
              <button
                type="button"
                onClick={() => void copy()}
                aria-label="Copy template commands"
                className={`${secondaryButton} absolute top-2 right-2 px-2`}
              >
                {copyState === "copied" ? <CheckCircleIcon size={16} className="text-success" aria-hidden="true" /> : <CopyIcon size={16} aria-hidden="true" />}
              </button>
            </div>
            <span role="status" className="sr-only">
              {copyState === "copied" ? "Template commands copied" : ""}
            </span>
            {copyState === "failed" && <p className="m-0 text-xs text-danger">Copy failed. Select the commands and copy them by hand.</p>}
            <p className="m-0 text-xs text-muted">No cloud-init drive: the app adds its own.</p>
            <p className="m-0 text-xs text-muted">
              Full guide: <span className="font-mono">docs/template-guide.md</span> in the repo
            </p>
          </GuideStep>
        </ol>
      )}
    </>
  );
}

function GuideStep({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="w-3 pt-0.5 font-mono text-xs text-muted">{number}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="m-0 text-sm font-semibold">{title}</p>
        {children}
      </div>
    </li>
  );
}
