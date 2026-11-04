import { EyeIcon, EyeSlashIcon, WarningIcon } from "@phosphor-icons/react";
import { useState, type FormEvent, type ReactNode } from "react";
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
import { hasSetupAgentCredential } from "../settings/settings-status";
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
  username: string;
  hasSshKey: boolean;
  sshPublicKey: string;
  hasPassword: boolean;
  password: string;
  confirmPassword: string;
  agentClis: AgentCli[];
  cores: number;
  memoryMb: number;
  diskGb: number;
};

type WorkspaceFormErrors = Partial<
  Record<"hostId" | "name" | "firstProjectRepoUrl" | "username" | "signIn" | "sshPublicKey" | "password" | "confirmPassword", string>
>;

const usernamePattern = /^[a-z_][a-z0-9_-]{0,31}$/;
const systemUsernames = ["root", "ubuntu"];

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
  if (!usernamePattern.test(form.username)) {
    errors.username = "Use a-z, 0-9, - and _, starting with a letter or _ (max 32).";
  } else if (systemUsernames.includes(form.username)) {
    errors.username = "That username is taken by the system. Pick another one.";
  }
  if (!form.hasSshKey && !form.hasPassword) errors.signIn = "Pick SSH key, Password, or both.";
  if (form.hasSshKey && !form.sshPublicKey.trim().startsWith("ssh-")) {
    errors.sshPublicKey = "Paste a public key that starts with ssh-, like the contents of ~/.ssh/id_ed25519.pub";
  }
  if (form.hasPassword) {
    if (form.password.length < 12 || form.password.length > 128 || /[\r\n]/.test(form.password)) {
      errors.password = "Use 12 to 128 characters, on one line.";
    } else if (form.confirmPassword !== form.password) {
      errors.confirmPassword = "The passwords don't match.";
    }
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
    username: "dev",
    hasSshKey: true,
    sshPublicKey: "",
    hasPassword: false,
    password: "",
    confirmPassword: "",
    agentClis: ["claude"],
    cores: 2,
    memoryMb: 4096,
    diskGb: 20,
  });
  const [fieldErrors, setFieldErrors] = useState<WorkspaceFormErrors>({});
  const [submitError, setSubmitError] = useState<string>();
  const [isSending, setIsSending] = useState(false);

  const signInDescribedBy = fieldErrors.signIn ? "workspace-signIn-error workspace-signIn-help" : "workspace-signIn-help";
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
    const submitted = { ...form, hostId, name: form.name.trim(), username: form.username.trim() };
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
        username: submitted.username,
        sshPublicKey: submitted.hasSshKey ? submitted.sshPublicKey.trim() : undefined,
        password: submitted.hasPassword ? submitted.password : undefined,
        agentClis: submitted.agentClis,
        cores: submitted.cores,
        memoryMb: submitted.memoryMb,
        diskGb: submitted.diskGb,
        firstProjectRepoUrl: submitted.firstProjectRepoUrl.trim() || undefined,
      });
      setForm((current) => ({ ...current, password: "", confirmPassword: "" }));
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
                id="workspace-username"
                label="Username"
                help="Linux user on the VM, with sudo. a-z, 0-9, - and _, up to 32 characters. Not root or ubuntu."
                error={fieldErrors.username}
              >
                {(props) => (
                  <input
                    {...props}
                    className={inputClass}
                    value={form.username}
                    onChange={(event) => update("username", event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </Field>
              <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
                <legend className="mb-1.5 p-0 text-sm font-semibold">Sign in with</legend>
                <div className="flex gap-3">
                  <CheckboxCard
                    id="workspace-signIn"
                    isChecked={form.hasSshKey}
                    onChange={(isChecked) => update("hasSshKey", isChecked)}
                    describedBy={signInDescribedBy}
                  >
                    SSH key <span className="ml-1 text-xs text-muted">recommended</span>
                  </CheckboxCard>
                  <CheckboxCard isChecked={form.hasPassword} onChange={(isChecked) => update("hasPassword", isChecked)} describedBy={signInDescribedBy}>
                    Password <span className="ml-1 text-xs text-muted">for machines without your key</span>
                  </CheckboxCard>
                </div>
                {fieldErrors.signIn && (
                  <p id="workspace-signIn-error" className="m-0 text-xs text-danger">
                    {fieldErrors.signIn}
                  </p>
                )}
                <p id="workspace-signIn-help" className="m-0 text-xs leading-[18px] text-muted">
                  Pick at least one.
                </p>
              </fieldset>
              {form.hasSshKey && (
                <Field
                  id="workspace-sshPublicKey"
                  label="SSH public key"
                  help="Added to the user above. Also used for git push through ssh -A."
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
              )}
              {form.hasPassword && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <div className="grid grid-cols-2 gap-4">
                      <Field id="workspace-password" label="Password" error={fieldErrors.password}>
                        {(props) => (
                          <PasswordInput
                            {...props}
                            aria-describedby={[props["aria-describedby"], "workspace-password-help"].filter(Boolean).join(" ")}
                            value={form.password}
                            onChange={(value) => update("password", value)}
                          />
                        )}
                      </Field>
                      <Field id="workspace-confirmPassword" label="Confirm password" error={fieldErrors.confirmPassword}>
                        {(props) => (
                          <PasswordInput
                            {...props}
                            aria-describedby={[props["aria-describedby"], "workspace-password-help"].filter(Boolean).join(" ")}
                            value={form.confirmPassword}
                            onChange={(value) => update("confirmPassword", value)}
                          />
                        )}
                      </Field>
                    </div>
                    <p id="workspace-password-help" className="m-0 text-xs leading-[18px] text-muted">
                      At least 12 characters. Set inside the VM through the guest agent after boot. The app never stores it and can't show it again.
                    </p>
                  </div>
                  <div className="flex gap-3 rounded-md border border-warn/40 bg-warn/10 px-4 py-3">
                    <WarningIcon size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
                    <p className="m-0 text-sm">
                      Anyone who can reach the VM on your network can try this password over SSH. The user has sudo without a password. Use a long, unique
                      password, or an SSH key only.
                    </p>
                  </div>
                </>
              )}
            </FormSection>

            <fieldset className="m-0 flex flex-col gap-3 border-0 border-t border-line p-0 pt-5">
              <legend className="float-left mb-3 w-full p-0 text-base font-semibold">Agent CLI</legend>
              <div className="flex gap-3">
                {agentOptions.map((option) => (
                  <CheckboxCard
                    key={option.value}
                    isChecked={form.agentClis.includes(option.value)}
                    onChange={(isChecked) => toggleAgent(option.value, isChecked)}
                  >
                    {option.name} <span className="ml-1 font-mono text-xs text-muted">{option.command}</span>
                  </CheckboxCard>
                ))}
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

            {settings.data && !hasSetupAgentCredential(settings.data) && (
              <p className="m-0 text-xs text-muted">
                The setup agent has no {settings.data.agentProvider === "claude" ? "Claude credential" : "Gemini API key"}, so projects will fail to set up.{" "}
                <Link href="/settings" className="focus-ring rounded-sm text-accent">
                  Add one on the Settings page first.
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
      <WhatHappens
        templateVmid={selectedHost?.templateVmid}
        username={form.username.trim() || "dev"}
        hasSshKey={form.hasSshKey}
        hasPassword={form.hasPassword}
      />
    </div>
  );
}

function CheckboxCard({
  id,
  isChecked,
  onChange,
  describedBy,
  children,
}: {
  id?: string;
  isChecked: boolean;
  onChange: (isChecked: boolean) => void;
  describedBy?: string;
  children: ReactNode;
}) {
  return (
    <label
      className={`flex flex-1 cursor-pointer items-center gap-3 rounded-md border px-4 py-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${
        isChecked ? "border-accent bg-accent/10" : "border-line"
      }`}
    >
      <input
        id={id}
        type="checkbox"
        className="size-4 shrink-0 accent-accent focus:outline-none"
        checked={isChecked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={describedBy}
      />
      <span className="text-sm">{children}</span>
    </label>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  "aria-invalid": isInvalid,
  "aria-describedby": describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
}) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={isPasswordVisible ? "text" : "password"}
        className={`${inputClass} pr-10`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="new-password"
        spellCheck={false}
        aria-invalid={isInvalid}
        aria-describedby={describedBy}
      />
      <button
        type="button"
        className="focus-ring absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-md text-muted hover:text-text"
        onClick={() => setIsPasswordVisible((current) => !current)}
        aria-label={isPasswordVisible ? "Hide password" : "Show password"}
        aria-pressed={isPasswordVisible}
      >
        {isPasswordVisible ? <EyeSlashIcon size={16} aria-hidden="true" /> : <EyeIcon size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}

function WhatHappens({
  templateVmid,
  username,
  hasSshKey,
  hasPassword,
}: {
  templateVmid: number | undefined;
  username: string;
  hasSshKey: boolean;
  hasPassword: boolean;
}) {
  const createUserStep = [`Boot, create user ${username}`, hasSshKey && " with your key", hasPassword && ", then set the password"]
    .filter(Boolean)
    .join("");
  const steps = [
    templateVmid === undefined ? "Clone the host's template" : `Clone template ${templateVmid}`,
    createUserStep,
    "Install Node 22, Docker and the agent CLI",
    "Clone the repo to ~/projects",
    "The setup agent starts its dev servers on free ports",
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
