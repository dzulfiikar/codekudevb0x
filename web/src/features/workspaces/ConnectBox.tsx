import { CheckCircleIcon, CodeIcon, CopyIcon } from "@phosphor-icons/react";
import { secondaryButton } from "../../shared/components/styles";
import type { Workspace } from "../../shared/api-types";
import { useCopy } from "../../shared/use-copy";
import { SideBox } from "./SideBox";

export function ConnectBox({ workspace, ip }: { workspace: Workspace; ip: string }) {
  const { username } = workspace;
  const command = `ssh -A ${username}@${ip}`;
  const { copyState, copy } = useCopy(command);

  return (
    <SideBox title="Connect">
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-inset px-3 py-[5px] font-mono text-[13px] leading-5 select-all">
          {command}
        </code>
        <button type="button" onClick={() => void copy()} className={`${secondaryButton} px-2`} aria-label="Copy SSH command">
          {copyState === "copied" ? <CheckCircleIcon size={16} className="text-success" aria-hidden="true" /> : <CopyIcon size={16} aria-hidden="true" />}
        </button>
      </div>
      <span role="status" className="sr-only">
        {copyState === "copied" ? "SSH command copied" : ""}
      </span>
      {copyState === "failed" && <p className="m-0 text-xs text-danger">Copy failed. Select the command and copy it by hand.</p>}
      <a href={`vscode://vscode-remote/ssh-remote+${username}@${ip}/home/${username}/projects`} className={`${secondaryButton} self-start no-underline`}>
        <CodeIcon size={16} aria-hidden="true" />
        Open ~/projects in VS Code
      </a>
      {workspace.hasPassword && (
        <p className="m-0 text-xs leading-5 text-muted">
          {workspace.hasSshKey ? "Sign in with your SSH key or the password you set." : "Sign in with the password you set. It isn't stored here."}
        </p>
      )}
      <p className="m-0 text-xs leading-5 text-muted">-A lets git push use your SSH key. No push token in the VM.</p>
    </SideBox>
  );
}
