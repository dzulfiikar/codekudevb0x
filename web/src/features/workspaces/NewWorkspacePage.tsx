import { useState, type FormEvent } from "react";
import { toErrorMessage } from "../../shared/api-client";
import type { AgentCli } from "../../shared/api-types";
import { ErrorBox } from "../../shared/components/ErrorBox";
import { Field, FormSection } from "../../shared/components/Field";
import { LoadingText } from "../../shared/components/LoadingText";
import { inputClass, primaryButton, secondaryButton, selectClass } from "../../shared/components/styles";
import { githubRepositoryUrlPattern, resourceNamePattern } from "../../shared/patterns";
import { Link, navigate } from "../../shared/router";
import { useResource } from "../../shared/use-resource";
import { useHosts } from "../hosts/HostsContext";
import { settingsApi } from "../settings/settings-api";
import { workspacesApi } from "./workspaces-api";

const coreOptions = [1, 2, 4, 6, 8];
const memoryOptions = [2048, 4096, 8192, 16384];
const diskOptions = [20, 32, 64, 128];

const agentOptions: { value: AgentCli; name: string; command: string }[] = [
  { value: "claude", name: "Claude Code", command: "claude" },
  { value: "antigravity", name: "Antigravity CLI", command: "agy" },
];

type WorkspaceForm = {
  hostId: string;
  name: string;
  githubToken: string;
  firstProjectRepoUrl: string;
  sshPublicKey: string;
  agentClis: AgentCli[];
  cores: number;
  memoryMb: number;
  diskGb: number;
};

type WorkspaceFormErrors = Partial<Record<"hostId" | "name" | "firstProjectRepoUrl" | "sshPublicKey", string>>;

function validateWorkspace(form: WorkspaceForm): WorkspaceFormErrors {
  const errors: WorkspaceFormErrors = {};
  if (!form.hostId) errors.hostId = "No host has a ready template yet. Prepare one on the Hosts page first.";
  if (!resourceNamePattern.test(form.name)) {
    errors.name = "Use 1 to 40 lowercase letters, numbers and dashes, starting with a letter or number.";
  }
  const repoUrl = form.firstProjectRepoUrl.trim();
  if (repoUrl && !githubRepositoryUrlPattern.test(repoUrl)) {
    errors.firstProjectRepoUrl = "Enter the full repository URL, like https://github.com/owner/repo";
  }
  if (!form.sshPublicKey.trim().startsWith("ssh-")) {
    errors.sshPublicKey = "Paste a public key that starts with ssh-, like the contents of ~/.ssh/id_ed25519.pub";
  }
  return errors;
}

export function NewWorkspacePage() {
  const hosts = useHosts();
  const settings = useResource(settingsApi.get, "settings");
  const hostList = hosts.data ?? [];
  const [form, setForm] = useState<WorkspaceForm>({
    hostId: "",
    name: "",
    githubToken: "",
    firstProjectRepoUrl: "",
    sshPublicKey: "",
    agentClis: ["claude"],
    cores: 2,
    memoryMb: 4096,
    diskGb: 20,
  });
  const [fieldErrors, setFieldErrors] = useState<WorkspaceFormErrors>({});
  const [submitError, setSubmitError] = useState<string>();
  const [isSending, setIsSending] = useState(false);

  const readyHosts = hostList.filter((host) => host.templateStatus === "ready");
  const hostId = form.hostId || readyHosts[0]?.id || "";
  const selectedHost = hostList.find((host) => host.id === hostId);

  function update<K extends keyof WorkspaceForm>(key: K, value: WorkspaceForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleAgent(agent: AgentCli, isChecked: boolean) {
    setForm((current) => ({
      ...current,
      agentClis: isChecked ? [...current.agentClis, agent] : current.agentClis.filter((value) => value !== agent),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = { ...form, hostId, name: form.name.trim() };
    const errors = validateWorkspace(submitted);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      const firstInvalid = Object.keys(errors)[0];
      document.getElementById(`workspace-${firstInvalid}`)?.focus();
      return;
    }
    setIsSending(true);
    setSubmitError(undefined);
    try {
      const workspace = await workspacesApi.create({
        hostId: submitted.hostId,
        name: submitted.name,
        githubToken: submitted.githubToken.trim() || undefined,
        sshPublicKey: submitted.sshPublicKey.trim(),
        agentClis: submitted.agentClis,
        cores: submitted.cores,
        memoryMb: submitted.memoryMb,
        diskGb: submitted.diskGb,
        firstProjectRepoUrl: submitted.firstProjectRepoUrl.trim() || undefined,
      });
      navigate(`/workspaces/${encodeURIComponent(workspace.id)}`);
    } catch (caught) {
      setSubmitError(toErrorMessage(caught));
      setIsSending(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-[1280px] grid-cols-[minmax(0,680px)_minmax(0,1fr)] items-start gap-16 px-10 pt-5 pb-10">
      <div className="flex min-w-0 flex-col gap-5">
        <nav aria-label="Breadcrumb" className="flex gap-2 text-sm">
          <Link href="/workspaces" className="focus-ring rounded-sm text-accent no-underline hover:underline">
            Workspaces
          </Link>
          <span className="text-muted" aria-hidden="true">
            /
          </span>
          <span className="font-semibold" aria-current="page">
            New
          </span>
        </nav>
        <h1 className="m-0 text-2xl font-semibold">New workspace</h1>
        {hosts.isLoading ? (
          <LoadingText>Loading Proxmox hosts</LoadingText>
        ) : hosts.error && !hosts.data ? (
          <ErrorBox title="Could not load Proxmox hosts">
            {hosts.error} A workspace needs a host, so the form stays hidden until the host list loads.
          </ErrorBox>
        ) : hostList.length === 0 ? (
          <div className="rounded-md border border-line bg-surface p-6">
            <p className="m-0 text-base font-semibold">Add a Proxmox host first</p>
            <p className="mt-2 mb-4 text-sm text-muted">A workspace is a VM cloned on one of your hosts, and none are set up yet.</p>
            <Link href="/hosts" className={`${primaryButton} no-underline`}>
              Add a Proxmox host
            </Link>
          </div>
        ) : (
          <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
            <FormSection>
              <Field
                id="workspace-hostId"
                label="Host"
                error={fieldErrors.hostId}
                help={
                  readyHosts.length < hostList.length && (
                    <>
                      Hosts without a ready template are disabled.{" "}
                      <Link href="/hosts" className="focus-ring rounded-sm text-accent">
                        Prepare this host first on the Hosts page
                      </Link>
                    </>
                  )
                }
              >
                {(props) => (
                  <select {...props} className={`${selectClass} font-sans`} value={hostId} onChange={(event) => update("hostId", event.target.value)}>
                    {readyHosts.length === 0 && (
                      <option value="" disabled>
                        No host has a ready template
                      </option>
                    )}
                    {hostList.map((host) => (
                      <option key={host.id} value={host.id} disabled={host.templateStatus !== "ready"}>
                        {host.name} (template {host.templateVmid}{" "}
                        {host.templateStatus === "ready" ? "ready" : host.templateStatus === "preparing" ? "building" : "not ready"})
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field
                id="workspace-name"
                label="Name"
                help="a-z, 0-9 and dashes. Also the VM name."
                error={fieldErrors.name}
              >
                {(props) => (
                  <input
                    {...props}
                    className={inputClass}
                    value={form.name}
                    onChange={(event) => update("name", event.target.value)}
                    placeholder="hackday"
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </Field>
            </FormSection>

            <FormSection title="GitHub">
              <Field
                id="workspace-githubToken"
                label="Token (optional)"
                help="Fine-grained token with read access to the repos you will add. Saved encrypted on this machine and used only to clone. Leave empty for public repos."
              >
                {(props) => (
                  <input
                    {...props}
                    type="password"
                    className={inputClass}
                    value={form.githubToken}
                    onChange={(event) => update("githubToken", event.target.value)}
                    placeholder="github_pat_..."
                    autoComplete="off"
                  />
                )}
              </Field>
              <Field id="workspace-firstProjectRepoUrl" label="First repo (optional)" error={fieldErrors.firstProjectRepoUrl}>
                {(props) => (
                  <input
                    {...props}
                    type="url"
                    className={inputClass}
                    value={form.firstProjectRepoUrl}
                    onChange={(event) => update("firstProjectRepoUrl", event.target.value)}
                    placeholder="https://github.com/owner/repo"
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </Field>
            </FormSection>

            <FormSection title="Access">
              <Field
                id="workspace-sshPublicKey"
                label="SSH public key"
                help="Added to user dev."
                error={fieldErrors.sshPublicKey}
              >
                {(props) => (
                  <textarea
                    {...props}
                    rows={3}
                    className={`${inputClass} resize-y`}
                    value={form.sshPublicKey}
                    onChange={(event) => update("sshPublicKey", event.target.value)}
                    placeholder="ssh-ed25519 AAAAC3Nza... you@laptop"
                    spellCheck={false}
                  />
                )}
              </Field>
            </FormSection>

            <fieldset className="m-0 flex flex-col gap-3 border-0 border-t border-line p-0 pt-5">
              <legend className="float-left mb-3 w-full p-0 text-base font-semibold">Agent CLI</legend>
              <div className="flex gap-3">
                {agentOptions.map((option) => {
                  const isChecked = form.agentClis.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className={`flex flex-1 cursor-pointer items-center gap-3 rounded-md border px-4 py-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${
                        isChecked ? "border-accent bg-accent/10" : "border-line"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-accent focus:outline-none"
                        checked={isChecked}
                        onChange={(event) => toggleAgent(option.value, event.target.checked)}
                      />
                      <span className="text-sm">
                        {option.name} <span className="ml-1 font-mono text-xs text-muted">{option.command}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <FormSection title="Size">
              <div className="grid grid-cols-3 gap-4">
                <Field id="workspace-cores" label="vCPU">
                  {(props) => (
                    <select {...props} className={`${selectClass} font-sans`} value={form.cores} onChange={(event) => update("cores", Number(event.target.value))}>
                      {coreOptions.map((cores) => (
                        <option key={cores} value={cores}>
                          {cores}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field id="workspace-memoryMb" label="RAM">
                  {(props) => (
                    <select {...props} className={`${selectClass} font-sans`} value={form.memoryMb} onChange={(event) => update("memoryMb", Number(event.target.value))}>
                      {memoryOptions.map((memoryMb) => (
                        <option key={memoryMb} value={memoryMb}>
                          {memoryMb / 1024} GB
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field id="workspace-diskGb" label="Disk">
                  {(props) => (
                    <select {...props} className={`${selectClass} font-sans`} value={form.diskGb} onChange={(event) => update("diskGb", Number(event.target.value))}>
                      {diskOptions.map((diskGb) => (
                        <option key={diskGb} value={diskGb}>
                          {diskGb} GB
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
            </FormSection>

            {settings.data?.geminiApiKeySource === "none" && (
              <p className="m-0 text-xs text-muted">
                Gemma has no API key, so projects will fail to set up.{" "}
                <Link href="/settings" className="focus-ring rounded-sm text-accent">
                  Add a Gemini API key on the Settings page first
                </Link>
              </p>
            )}

            {submitError && <ErrorBox title="Could not create the workspace">{submitError}</ErrorBox>}

            <div className="flex gap-3">
              <button type="submit" className={primaryButton} disabled={isSending}>
                {isSending ? "Creating workspace" : "Create workspace"}
              </button>
              <Link href="/workspaces" className={`${secondaryButton} no-underline`}>
                Cancel
              </Link>
            </div>
          </form>
        )}
      </div>
      <WhatHappens templateVmid={selectedHost?.templateVmid} />
    </div>
  );
}

function WhatHappens({ templateVmid }: { templateVmid: number | undefined }) {
  const steps = [
    templateVmid === undefined ? "Clone the host's template" : `Clone template ${templateVmid}`,
    "Boot, create user dev with your key",
    "Install Node 22, Docker and the agent CLI",
    "Clone the repo to ~/projects",
    "Gemma starts its dev servers on free ports",
    "Show links and the ssh command",
  ];
  return (
    <aside className="flex flex-col gap-3 pt-[60px]" aria-labelledby="what-happens-title">
      <h2 id="what-happens-title" className="m-0 text-base font-semibold">
        What happens
      </h2>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map((step, index) => (
          <li key={step} className="flex items-center gap-3 text-sm">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-button text-xs font-semibold">{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </aside>
  );
}
