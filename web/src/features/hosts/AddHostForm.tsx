import { useState, type FormEvent } from "react";
import { toErrorMessage } from "../../shared/api-client";
import type { CreateHostInput, HostCheck } from "../../shared/api-types";
import { ErrorBox } from "../../shared/components/ErrorBox";
import { Field } from "../../shared/components/Field";
import { StatusLabel } from "../../shared/components/StatusLabel";
import { boxClass, boxHeaderClass, inputClass, primaryButton, secondaryButton } from "../../shared/components/styles";
import { HostChecklist, summarizeCheck } from "./HostChecklist";
import { findHostCheck, hostsApi } from "./hosts-api";

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

export function AddHostForm({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState<HostForm>(emptyHostForm);
  const [fieldErrors, setFieldErrors] = useState<HostFormErrors>({});
  const [submitError, setSubmitError] = useState<{ baseUrl: string; message: string }>();
  const [checkResult, setCheckResult] = useState<HostCheck>();
  const [sending, setSending] = useState<"check" | "save">();

  function update<K extends keyof HostForm>(key: K, value: HostForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toCreateHostInput(): CreateHostInput {
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
      const { name: _name, ...host } = toCreateHostInput();
      setCheckResult(await hostsApi.checkUnsavedHost(host));
    } catch (caught) {
      setSubmitError({ baseUrl: form.baseUrl.trim(), message: toErrorMessage(caught) });
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
      await hostsApi.create(toCreateHostInput());
      setForm(emptyHostForm);
      onAdded();
    } catch (caught) {
      setSubmitError({ baseUrl: form.baseUrl.trim(), message: toErrorMessage(caught) });
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
