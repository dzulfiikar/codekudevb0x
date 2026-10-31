import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CopyIcon,
  DownloadSimpleIcon,
  HardDrivesIcon,
  PlugsConnectedIcon,
} from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, errorMessage, findHostCheck, type Host, type HostCheck, type HostTestResult, type NewHost, type Workspace } from "../api";
import {
  ErrorBox,
  LoadingText,
  StatusLabel,
  boxClass,
  boxHeaderClass,
  dangerButton,
  inputClass,
  primaryButton,
  secondaryButton,
  useCopy,
  useHosts,
  useResource,
} from "../ui";
import { Field } from "./Field";
import { HostChecklist, formatTimeAgo, summarizeCheck } from "./HostChecklist";

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

function summarizeWorkspaces(workspaces: Workspace[]): string {
  if (workspaces.length === 0) return "No workspaces yet. Remove is allowed.";
  const names = workspaces.map((workspace) => workspace.name).join(", ");
  return `${workspaces.length} ${workspaces.length === 1 ? "workspace" : "workspaces"}: ${names}`;
}

function HostCard({
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
  const [testResult, setTestResult] = useState<HostTestResult>();
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
      setActionError({ title, message: errorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  const testConnection = () =>
    runAction(
      `Could not reach ${host.baseUrl}`,
      async () => {
        setTestResult(await api.testHost(host.id));
      },
      setIsTesting,
    );
  const runChecks = () =>
    runAction(
      "Checks did not run",
      async () => {
        await api.checkHost(host.id);
        onChanged();
      },
      setIsChecking,
    );
  const prepareHost = () =>
    runAction(
      `Could not start preparing ${host.name}`,
      async () => {
        await api.prepareHost(host.id);
        onChanged();
      },
      setIsStartingPrepare,
    );
  const removeHost = () =>
    runAction(
      `Could not remove ${host.name}`,
      async () => {
        setIsConfirmingRemove(false);
        await api.deleteHost(host.id);
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

function needsTemplateGuide(host: Host): boolean {
  if (host.templateStatus === "missing" || host.templateStatus === "failed") return true;
  const templateCheck = host.lastCheck?.checks.find((check) => check.id === "template");
  return templateCheck !== undefined && templateCheck.status !== "ok";
}

function TemplateSection({ host, isStartingPrepare, onPrepare }: { host: Host; isStartingPrepare: boolean; onPrepare: () => void }) {
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

type HostForm = {
  name: string;
  baseUrl: string;
  tokenId: string;
  tokenSecret: string;
  node: string;
  templateVmid: string;
  bridge: string;
  allowSelfSigned: boolean;
};

const emptyHostForm: HostForm = {
  name: "",
  baseUrl: "",
  tokenId: "",
  tokenSecret: "",
  node: "",
  templateVmid: "",
  bridge: "",
  allowSelfSigned: false,
};

type HostFormErrors = Partial<Record<keyof HostForm, string>>;

function validateHost(form: HostForm): HostFormErrors {
  const errors: HostFormErrors = {};
  if (!form.name.trim()) errors.name = "Enter a name, like homelab.";
  if (!/^https:\/\/\S+$/.test(form.baseUrl.trim())) errors.baseUrl = "Enter the HTTPS URL, like https://pve.your-tailnet.ts.net";
  if (!form.tokenId.includes("!")) errors.tokenId = "Use the full token ID, like user@pam!codeku.";
  if (!form.tokenSecret.trim()) errors.tokenSecret = "Paste the token secret.";
  if (form.templateVmid.trim() && !/^\d+$/.test(form.templateVmid.trim())) errors.templateVmid = "Use a number, like 9000.";
  return errors;
}

function AddHostForm({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState<HostForm>(emptyHostForm);
  const [fieldErrors, setFieldErrors] = useState<HostFormErrors>({});
  const [submitError, setSubmitError] = useState<{ baseUrl: string; message: string }>();
  const [checkResult, setCheckResult] = useState<HostCheck>();
  const [sending, setSending] = useState<"check" | "save">();

  function update<K extends keyof HostForm>(key: K, value: HostForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toNewHost(): NewHost {
    return {
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      tokenId: form.tokenId.trim(),
      tokenSecret: form.tokenSecret.trim(),
      node: form.node.trim() || undefined,
      templateVmid: form.templateVmid.trim() ? Number(form.templateVmid) : undefined,
      bridge: form.bridge.trim() || undefined,
      allowSelfSigned: form.allowSelfSigned,
    };
  }

  async function checkHost() {
    const { name: _nameError, ...errors } = validateHost(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSending("check");
    setSubmitError(undefined);
    setCheckResult(undefined);
    try {
      const { name: _name, ...host } = toNewHost();
      setCheckResult(await api.checkNewHost(host));
    } catch (caught) {
      setSubmitError({ baseUrl: form.baseUrl.trim(), message: errorMessage(caught) });
    } finally {
      setSending(undefined);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateHost(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSending("save");
    setSubmitError(undefined);
    setCheckResult(undefined);
    try {
      await api.createHost(toNewHost());
      setForm(emptyHostForm);
      onAdded();
    } catch (caught) {
      setSubmitError({ baseUrl: form.baseUrl.trim(), message: errorMessage(caught) });
      setCheckResult(findHostCheck(caught));
    } finally {
      setSending(undefined);
    }
  }

  function input(
    key: Exclude<keyof HostForm, "allowSelfSigned">,
    label: string,
    props: { placeholder?: string; type?: string } = {},
    help?: string,
  ) {
    return (
      <Field id={`host-${key}`} label={label} help={help} error={fieldErrors[key]}>
        {(fieldProps) => (
          <input
            {...fieldProps}
            {...props}
            className={inputClass}
            value={form[key]}
            onChange={(event) => update(key, event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </Field>
    );
  }

  const checkSummary = checkResult ? summarizeCheck(checkResult) : undefined;

  return (
    <section className={boxClass} aria-labelledby="add-host-title">
      <div className={boxHeaderClass}>
        <h2 id="add-host-title" className="m-0 text-sm font-semibold">
          Add host
        </h2>
      </div>
      <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4 p-4">
        {submitError && <ErrorBox title={`Could not add ${submitError.baseUrl}`}>{submitError.message}</ErrorBox>}
        {checkResult && checkSummary && (
          <div role="status" className="overflow-hidden rounded-md border border-line">
            <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2 text-sm">
              <StatusLabel tone={checkSummary.tone === "danger" ? "danger" : "success"}>{checkSummary.label}</StatusLabel>
              <span className="text-muted">{checkSummary.text}</span>
            </div>
            <HostChecklist check={checkResult} />
            {!checkResult.ready && (
              <p className="m-0 border-t border-line-muted px-4 py-2 text-xs text-muted">Fix the failed checks before adding.</p>
            )}
          </div>
        )}
        {input("name", "Name", { placeholder: "homelab" })}
        {input("baseUrl", "API URL", { placeholder: "https://pve.your-tailnet.ts.net" })}
        {input("tokenId", "Token ID", { placeholder: "user@pam!codeku" }, "Needs Administrator on / for both user and token.")}
        {input("tokenSecret", "Token secret", { type: "password" })}
        <div className="grid grid-cols-3 items-start gap-3">
          {input("node", "Node", { placeholder: "auto" })}
          {input("templateVmid", "Template", { placeholder: "9000" })}
          {input("bridge", "Bridge", { placeholder: "vmbr0" })}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="focus-ring size-4 accent-accent"
            checked={form.allowSelfSigned}
            onChange={(event) => update("allowSelfSigned", event.target.checked)}
          />
          Self-signed certificate
        </label>
        <div className="flex gap-2">
          <button type="submit" className={primaryButton} disabled={sending !== undefined}>
            {sending === "save" ? "Checking and adding" : "Check and add"}
          </button>
          <button type="button" className={secondaryButton} onClick={() => void checkHost()} disabled={sending !== undefined}>
            {sending === "check" ? "Checking" : "Check only"}
          </button>
        </div>
      </form>
    </section>
  );
}
