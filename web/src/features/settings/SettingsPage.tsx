import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  CopyIcon,
  KeyIcon,
  PlugsConnectedIcon,
  SparkleIcon,
  TrashIcon,
  UserCircleIcon,
  WarningIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toErrorMessage } from "../../shared/api-client";
import type {
  AgentProvider,
  ClaudeCredentialKind,
  ClaudeCredentialTestResult,
  ClaudeModel,
  GeminiApiKeyTestResult,
  Settings,
  SettingsInput,
} from "../../shared/api-types";
import { ErrorBox } from "../../shared/components/ErrorBox";
import { Field } from "../../shared/components/Field";
import { LoadingText } from "../../shared/components/LoadingText";
import { PageLayout } from "../../shared/components/PageLayout";
import { StatusLabel } from "../../shared/components/StatusLabel";
import { boxClass, boxHeaderClass, dangerButton, inputClass, primaryButton, secondaryButton, selectClass } from "../../shared/components/styles";
import { useCopy } from "../../shared/use-copy";
import { useResource } from "../../shared/use-resource";
import { settingsApi } from "./settings-api";

const pageDescription = "Which AI runs the setup agent, its sign-in, models and prompt. Changes apply to the next project.";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; message: string } | { kind: "failed"; message: string };

type Reload = () => Promise<void>;

async function save(update: SettingsInput, setState: (state: SaveState) => void, savedMessage: string, reload: Reload): Promise<boolean> {
  setState({ kind: "saving" });
  try {
    await settingsApi.save(update);
    await reload();
    setState({ kind: "saved", message: savedMessage });
    return true;
  } catch (caught) {
    setState({ kind: "failed", message: toErrorMessage(caught) });
    return false;
  }
}

export function SettingsPage() {
  const settings = useResource(settingsApi.get, "settings");
  const loaded = settings.data;

  if (settings.isLoading) {
    return (
      <PageLayout title="Settings" description={pageDescription}>
        <LoadingText>Loading settings</LoadingText>
      </PageLayout>
    );
  }

  if (!loaded) {
    return (
      <PageLayout title="Settings" description={pageDescription}>
        <ErrorBox title="Could not load settings">
          {settings.error}{" "}
          <button type="button" onClick={() => void settings.reload()} className="focus-ring cursor-pointer rounded-sm bg-transparent p-0 font-semibold text-accent">
            Try again
          </button>
        </ErrorBox>
      </PageLayout>
    );
  }

  const isClaudeSelected = loaded.agentProvider === "claude";

  return (
    <PageLayout title="Settings" description={pageDescription}>
      <SetupAgentBox provider={loaded.agentProvider} reload={settings.reload} />
      {isClaudeSelected ? (
        <>
          <div className="grid grid-cols-2 items-start gap-6">
            <ClaudeSignInBox settings={loaded} reload={settings.reload} />
            <ModelsBox
              key="claude"
              primaryId="settings-claudePrimaryModel"
              fallbackId="settings-claudeFallbackModel"
              models={loaded.claudeAvailableModels.map((model) => ({ id: model.id, label: describeClaudeModel(model) }))}
              storedPrimary={loaded.claudePrimaryModel}
              storedFallback={loaded.claudeFallbackModel}
              primaryHelp="Runs every project setup. The list comes from your Claude account."
              fallbackHelp="Takes over when the primary is overloaded. Pick None to only retry."
              emptyMessage="No Claude models came back. Check the sign-in, then reload this page."
              toUpdate={(primary, fallback) => ({ claudePrimaryModel: primary, claudeFallbackModel: fallback })}
              reload={settings.reload}
            />
          </div>
          <PlanUsageBox />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 items-start gap-6">
            <GeminiKeyBox settings={loaded} reload={settings.reload} />
            <ModelsBox
              key="gemini"
              primaryId="settings-primaryModel"
              fallbackId="settings-fallbackModel"
              models={loaded.availableModels.map((model) => ({ id: model.id, label: model.id }))}
              storedPrimary={loaded.primaryModel}
              storedFallback={loaded.fallbackModel}
              primaryHelp="Used for every project setup."
              fallbackHelp="Takes over when the primary hits its rate limit. Pick None to only wait."
              emptyMessage="No Gemma models came back. Check the key, then reload this page."
              toUpdate={(primary, fallback) => ({ primaryModel: primary, fallbackModel: fallback })}
              reload={settings.reload}
            />
          </div>
          <FreeTierLimitsBox primaryModel={loaded.primaryModel} fallbackModel={loaded.fallbackModel} />
        </>
      )}
      <AgentPromptBox settings={loaded} reload={settings.reload} />
    </PageLayout>
  );
}

const providerOptions: { value: AgentProvider; name: string; description: string; icon: Icon }[] = [
  {
    value: "claude",
    name: "Claude",
    description: "Claude Agent SDK. Sign in with your Claude plan token or an Anthropic API key.",
    icon: SparkleIcon,
  },
  {
    value: "gemini",
    name: "Gemini API",
    description: "Gemma 4 through Google AI Studio. Free tier, rate limited.",
    icon: KeyIcon,
  },
];

function SetupAgentBox({ provider, reload }: { provider: AgentProvider; reload: Reload }) {
  const [pendingProvider, setPendingProvider] = useState<AgentProvider>();
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const checkedProvider = pendingProvider ?? provider;

  async function choose(option: (typeof providerOptions)[number]) {
    if (saveState.kind === "saving") return;
    setPendingProvider(option.value);
    await save({ agentProvider: option.value }, setSaveState, `Switched to ${option.name}.`, reload);
    setPendingProvider(undefined);
  }

  return (
    <section className={boxClass} aria-labelledby="agent-title">
      <div className={boxHeaderClass}>
        <h2 id="agent-title" className="m-0 text-sm font-semibold">
          Setup agent
        </h2>
        {saveState.kind === "saving" && <span className="text-xs text-muted">Saving</span>}
      </div>
      <div className="flex flex-col gap-4 p-4">
        <fieldset aria-labelledby="agent-title" className="m-0 grid grid-cols-2 gap-4 border-0 p-0">
          {providerOptions.map((option) => {
            const isChecked = checkedProvider === option.value;
            const OptionIcon = option.icon;
            return (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-md has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${
                  isChecked ? "border-2 border-accent bg-accent/10 px-[15px] py-[11px]" : "border border-line px-4 py-3"
                }`}
              >
                <input
                  type="radio"
                  name="agentProvider"
                  value={option.value}
                  className="mt-0.5 size-4 shrink-0 accent-accent focus:outline-none"
                  checked={isChecked}
                  onChange={() => void choose(option)}
                />
                <span className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <OptionIcon size={16} className="text-muted" aria-hidden="true" />
                    {option.name}
                  </span>
                  <span className="text-xs leading-[18px] text-muted">{option.description}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <div role="status">{saveState.kind === "saved" && <Notice>{saveState.message}</Notice>}</div>
        {saveState.kind === "failed" && <ErrorBox title="Setup agent not saved">{saveState.message}</ErrorBox>}
      </div>
    </section>
  );
}

function GeminiKeyBox({ settings, reload }: { settings: Settings; reload: Reload }) {
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [testResult, setTestResult] = useState<GeminiApiKeyTestResult>();
  const [isTesting, setIsTesting] = useState(false);
  const [keyState, setKeyState] = useState<SaveState>({ kind: "idle" });
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const hasKey = settings.geminiApiKeySource === "database";
  const typedKey = geminiApiKey.trim();

  async function testKey() {
    setIsTesting(true);
    setTestResult(undefined);
    try {
      setTestResult(await settingsApi.testGeminiApiKey(typedKey || undefined));
    } catch (caught) {
      setTestResult({ ok: false, message: toErrorMessage(caught) });
    } finally {
      setIsTesting(false);
    }
  }

  async function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!typedKey) return;
    await save({ geminiApiKey: typedKey }, setKeyState, "Key saved.", reload);
    setGeminiApiKey("");
    setTestResult(undefined);
  }

  function removeKey() {
    setIsConfirmingRemove(false);
    setTestResult(undefined);
    void save({ geminiApiKey: "" }, setKeyState, "Key removed. Projects cannot be set up until you add a new one.", reload);
  }

  return (
    <section className={boxClass} aria-labelledby="key-title">
      <div className={boxHeaderClass}>
        <h2 id="key-title" className="m-0 text-sm font-semibold">
          Gemini API key
        </h2>
        {hasKey ? <StatusLabel tone="success">Saved</StatusLabel> : <StatusLabel tone="danger">Not set</StatusLabel>}
      </div>
      <form noValidate onSubmit={(event) => void saveKey(event)} className="flex flex-col gap-4 p-4">
        {hasKey ? (
          <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
            <KeyIcon size={16} className="text-muted" aria-hidden="true" />
            <span className="flex-1 text-sm">
              Key ending <span className="ml-1 font-mono">{settings.geminiApiKeyHint ?? "unknown"}</span>
            </span>
            {isConfirmingRemove ? (
              <span className="flex items-center gap-2">
                <button type="button" className={dangerButton} onClick={removeKey} disabled={keyState.kind === "saving"}>
                  Remove
                </button>
                <button type="button" className={secondaryButton} onClick={() => setIsConfirmingRemove(false)}>
                  Keep key
                </button>
              </span>
            ) : (
              <button type="button" className={dangerButton} onClick={() => setIsConfirmingRemove(true)} disabled={keyState.kind === "saving"}>
                <TrashIcon size={16} aria-hidden="true" />
                Remove
              </button>
            )}
          </div>
        ) : (
          <p className="m-0 text-sm text-muted">No key yet. Add a key from Google AI Studio to let Gemma set up projects.</p>
        )}
        <Field id="settings-geminiApiKey" label={hasKey ? "Replace key" : "API key"} help="From Google AI Studio. Stored encrypted.">
          {(props) => (
            <input
              {...props}
              type="password"
              className={inputClass}
              value={geminiApiKey}
              onChange={(event) => {
                setGeminiApiKey(event.target.value);
                setTestResult(undefined);
                setKeyState({ kind: "idle" });
              }}
              placeholder="AIza..."
              autoComplete="off"
            />
          )}
        </Field>
        <div className="flex gap-2">
          <button type="button" className={secondaryButton} onClick={() => void testKey()} disabled={isTesting || (!typedKey && !hasKey)}>
            <PlugsConnectedIcon size={16} aria-hidden="true" />
            {isTesting ? "Testing" : "Test key"}
          </button>
          <button type="submit" className={primaryButton} disabled={!typedKey || keyState.kind === "saving"}>
            {keyState.kind === "saving" ? "Saving" : "Save key"}
          </button>
        </div>
        {!typedKey && !hasKey && <p className="m-0 text-xs text-muted">Paste a key to test or save it.</p>}
        <div role="status">
          {testResult?.ok && (
            <Notice>
              Key works. {testResult.modelCount} Gemma {testResult.modelCount === 1 ? "model" : "models"} available.
            </Notice>
          )}
          {keyState.kind === "saved" && <Notice>{keyState.message}</Notice>}
        </div>
        {testResult && !testResult.ok && <ErrorBox title="Key test failed">{testResult.message}</ErrorBox>}
        {keyState.kind === "failed" && <ErrorBox title="Key not saved">{keyState.message}</ErrorBox>}
      </form>
    </section>
  );
}

const credentialKindName: Record<ClaudeCredentialKind, string> = {
  plan_token: "Plan token",
  api_key: "API key",
};

const setupTokenCommand = "claude setup-token";

// Live model descriptions often start with the display name already ("Opus 5.5 · Best for ...").
function describeClaudeModel(model: ClaudeModel): string {
  return model.description.startsWith(model.displayName) ? model.description : `${model.displayName} — ${model.description}`;
}

function describeClaudeTest(result: Extract<ClaudeCredentialTestResult, { ok: true }>): string {
  const models = `${result.modelCount} ${result.modelCount === 1 ? "model" : "models"} available.`;
  if (result.credentialKind === "api_key") return `API key works. ${models}`;
  if (!result.subscriptionType) return `Works. ${models}`;
  const plan = result.subscriptionType;
  const planName = /^claude\b/i.test(plan) ? plan : `Claude ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;
  return `Works. Signed in to ${planName}, ${models}`;
}

function ClaudeSignInBox({ settings, reload }: { settings: Settings; reload: Reload }) {
  const [claudeCredential, setClaudeCredential] = useState("");
  const [testResult, setTestResult] = useState<ClaudeCredentialTestResult>();
  const [isTesting, setIsTesting] = useState(false);
  const [credentialState, setCredentialState] = useState<SaveState>({ kind: "idle" });
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const { copyState, copy } = useCopy(setupTokenCommand);
  const storedKind = settings.claudeCredentialKind;
  const hasCredential = storedKind !== null;
  const typedCredential = claudeCredential.trim();

  async function testCredential() {
    setIsTesting(true);
    setTestResult(undefined);
    try {
      setTestResult(await settingsApi.testClaudeCredential(typedCredential || undefined));
    } catch (caught) {
      setTestResult({ ok: false, message: toErrorMessage(caught) });
    } finally {
      setIsTesting(false);
    }
  }

  async function saveCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!typedCredential) return;
    await save({ claudeCredential: typedCredential }, setCredentialState, "Credential saved.", reload);
    setClaudeCredential("");
    setTestResult(undefined);
  }

  function removeCredential() {
    setIsConfirmingRemove(false);
    setTestResult(undefined);
    void save({ claudeCredential: "" }, setCredentialState, "Credential removed. Projects cannot be set up until you add a new one.", reload);
  }

  return (
    <section className={boxClass} aria-labelledby="claude-sign-in-title">
      <div className={boxHeaderClass}>
        <h2 id="claude-sign-in-title" className="m-0 text-sm font-semibold">
          Claude sign-in
        </h2>
        {hasCredential ? <StatusLabel tone="success">Connected</StatusLabel> : <StatusLabel tone="danger">Not set</StatusLabel>}
      </div>
      <form noValidate onSubmit={(event) => void saveCredential(event)} className="flex flex-col gap-4 p-4">
        {hasCredential ? (
          <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
            <UserCircleIcon size={16} className="text-muted" aria-hidden="true" />
            <span className="flex-1 text-sm">
              {credentialKindName[storedKind]} ending <span className="ml-1 font-mono">{settings.claudeCredentialHint ?? "unknown"}</span>
            </span>
            {isConfirmingRemove ? (
              <span className="flex items-center gap-2">
                <button type="button" className={dangerButton} onClick={removeCredential} disabled={credentialState.kind === "saving"}>
                  Remove
                </button>
                <button type="button" className={secondaryButton} onClick={() => setIsConfirmingRemove(false)}>
                  Keep credential
                </button>
              </span>
            ) : (
              <button
                type="button"
                className={dangerButton}
                onClick={() => setIsConfirmingRemove(true)}
                disabled={credentialState.kind === "saving"}
              >
                <TrashIcon size={16} aria-hidden="true" />
                Remove
              </button>
            )}
          </div>
        ) : (
          <p className="m-0 text-sm text-muted">No credential yet. Add a plan token or an API key to let Claude set up projects.</p>
        )}
        <Field
          id="settings-claudeCredential"
          label={hasCredential ? "Replace credential" : "Credential"}
          help="Paste the token this command prints on a machine where you are signed in to Claude, or an Anthropic API key. Stored encrypted."
        >
          {(props) => (
            <>
              <input
                {...props}
                type="password"
                className={inputClass}
                value={claudeCredential}
                onChange={(event) => {
                  setClaudeCredential(event.target.value);
                  setTestResult(undefined);
                  setCredentialState({ kind: "idle" });
                }}
                placeholder="sk-ant-oat01-... or sk-ant-api03-..."
                autoComplete="off"
              />
              <div className="flex items-center gap-2 rounded-md border border-line bg-inset py-1 pr-1 pl-3">
                <code className="flex-1 font-mono text-xs text-text">$ {setupTokenCommand}</code>
                <span role="status" className="text-xs text-muted">
                  {copyState === "copied" ? "Copied" : ""}
                </span>
                <button type="button" onClick={() => void copy()} aria-label="Copy command" className={`${secondaryButton} px-2 py-1`}>
                  {copyState === "copied" ? (
                    <CheckCircleIcon size={16} className="text-success" aria-hidden="true" />
                  ) : (
                    <CopyIcon size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
              {copyState === "failed" && <p className="m-0 text-xs text-danger">Copy failed. Select the command and copy it by hand.</p>}
            </>
          )}
        </Field>
        <div className="flex gap-2">
          <button
            type="button"
            className={secondaryButton}
            onClick={() => void testCredential()}
            disabled={isTesting || (!typedCredential && !hasCredential)}
          >
            <PlugsConnectedIcon size={16} aria-hidden="true" />
            {isTesting ? "Testing" : "Test"}
          </button>
          <button type="submit" className={primaryButton} disabled={!typedCredential || credentialState.kind === "saving"}>
            {credentialState.kind === "saving" ? "Saving" : "Save"}
          </button>
        </div>
        {!typedCredential && !hasCredential && <p className="m-0 text-xs text-muted">Paste a credential to test or save it.</p>}
        <div role="status">
          {testResult?.ok && <Notice>{describeClaudeTest(testResult)}</Notice>}
          {credentialState.kind === "saved" && <Notice>{credentialState.message}</Notice>}
        </div>
        {testResult && !testResult.ok && <ErrorBox title="Test failed">{testResult.message}</ErrorBox>}
        {credentialState.kind === "failed" && <ErrorBox title="Credential not saved">{credentialState.message}</ErrorBox>}
      </form>
    </section>
  );
}

type ModelOption = { id: string; label: string };

function withStoredModel(models: ModelOption[], storedModel: string | null): ModelOption[] {
  if (!storedModel || models.some((model) => model.id === storedModel)) return models;
  return [...models, { id: storedModel, label: `${storedModel} (not in the model list)` }];
}

function ModelsBox({
  primaryId,
  fallbackId,
  models,
  storedPrimary,
  storedFallback,
  primaryHelp,
  fallbackHelp,
  emptyMessage,
  toUpdate,
  reload,
}: {
  primaryId: string;
  fallbackId: string;
  models: ModelOption[];
  storedPrimary: string;
  storedFallback: string | null;
  primaryHelp: string;
  fallbackHelp: string;
  emptyMessage: string;
  toUpdate: (primaryModel: string, fallbackModel: string | null) => SettingsInput;
  reload: Reload;
}) {
  const [primaryModel, setPrimaryModel] = useState(storedPrimary);
  const [fallbackModel, setFallbackModel] = useState(storedFallback ?? "");
  const [fallbackError, setFallbackError] = useState<string>();
  const [modelState, setModelState] = useState<SaveState>({ kind: "idle" });
  const titleId = `${primaryId}-box-title`;

  useEffect(() => {
    setPrimaryModel(storedPrimary);
    setFallbackModel(storedFallback ?? "");
  }, [storedPrimary, storedFallback]);

  function saveModels(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fallbackModel && fallbackModel === primaryModel) {
      setFallbackError("Pick a different fallback, or None.");
      document.getElementById(fallbackId)?.focus();
      return;
    }
    setFallbackError(undefined);
    void save(toUpdate(primaryModel, fallbackModel || null), setModelState, "Models saved.", reload);
  }

  return (
    <section className={boxClass} aria-labelledby={titleId}>
      <div className={boxHeaderClass}>
        <h2 id={titleId} className="m-0 text-sm font-semibold">
          Models
        </h2>
      </div>
      <form noValidate onSubmit={saveModels} className="flex flex-col gap-4 p-4">
        {models.length === 0 && <p className="m-0 text-xs text-muted">{emptyMessage}</p>}
        <Field id={primaryId} label="Primary" help={primaryHelp}>
          {(props) => (
            <select
              {...props}
              className={selectClass}
              value={primaryModel}
              onChange={(event) => {
                setPrimaryModel(event.target.value);
                setModelState({ kind: "idle" });
              }}
            >
              {withStoredModel(models, storedPrimary).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id={fallbackId} label="Fallback" help={fallbackHelp} error={fallbackError}>
          {(props) => (
            <select
              {...props}
              className={selectClass}
              value={fallbackModel}
              onChange={(event) => {
                setFallbackModel(event.target.value);
                setFallbackError(undefined);
                setModelState({ kind: "idle" });
              }}
            >
              <option value="">None</option>
              {withStoredModel(models, storedFallback).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div>
          <button type="submit" className={primaryButton} disabled={modelState.kind === "saving"}>
            {modelState.kind === "saving" ? "Saving" : "Save models"}
          </button>
        </div>
        <div role="status">{modelState.kind === "saved" && <Notice>{modelState.message}</Notice>}</div>
        {modelState.kind === "failed" && <ErrorBox title="Models not saved">{modelState.message}</ErrorBox>}
      </form>
    </section>
  );
}

const planUsageRows = [
  { model: "Opus", usage: "Highest", goodFor: "Repos with several services, unusual stacks, or failed first tries" },
  { model: "Sonnet", usage: "Medium", goodFor: "Most repos. A good default if you hit limits often" },
  { model: "Haiku", usage: "Lowest", goodFor: "Small single-service repos with a clear README" },
];

function PlanUsageBox() {
  return (
    <section className={boxClass} aria-labelledby="plan-usage-title">
      <div className={boxHeaderClass}>
        <h2 id="plan-usage-title" className="m-0 text-sm font-semibold">
          Plan usage
        </h2>
        <span className="text-xs text-muted">Plan tokens share limits with Claude Code and claude.ai</span>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="w-1/6 px-4 py-2 font-semibold">Model</th>
                <th className="w-1/4 px-4 py-2 font-semibold">Plan usage per setup</th>
                <th className="px-4 py-2 font-semibold">Good for</th>
              </tr>
            </thead>
            <tbody>
              {planUsageRows.map((row) => (
                <tr key={row.model} className="border-t border-line-muted">
                  <td className="px-4 py-2 font-semibold">{row.model}</td>
                  <td className="px-4 py-2">{row.usage}</td>
                  <td className="px-4 py-2 text-muted">{row.goodFor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 text-sm text-muted">
          With a plan token, setups count against your plan's usage limit; if it runs out mid-setup, the project fails with the reset time and you can retry. With
          an API key, setups are billed per token.
        </p>
      </div>
    </section>
  );
}

function FreeTierLimitsBox({ primaryModel, fallbackModel }: { primaryModel: string; fallbackModel: string | null }) {
  return (
    <section className={boxClass} aria-labelledby="limits-title">
      <div className={boxHeaderClass}>
        <h2 id="limits-title" className="m-0 text-sm font-semibold">
          Free-tier limits
        </h2>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="w-1/3 px-4 py-2 font-semibold">Model</th>
                <th className="px-4 py-2 font-semibold">What the agent does</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line-muted">
                <td className="px-4 py-2 font-mono text-xs">{primaryModel}</td>
                <td className="px-4 py-2">Waits for the time the API asks, then retries</td>
              </tr>
              <tr className="border-t border-line-muted">
                <td className="px-4 py-2 font-mono text-xs">{fallbackModel ?? "None"}</td>
                <td className="px-4 py-2">{fallbackModel ? "Used while the primary waits" : "No fallback. The agent only waits."}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="m-0 text-sm text-muted">On the free tier, most setup time is waiting for the per-minute limit to reset.</p>
      </div>
    </section>
  );
}

const agentPromptLimit = 20_000;

const placeholderExamples = [
  { placeholder: "{username}", example: "dev" },
  { placeholder: "{projectName}", example: "sandbox-demo" },
  { placeholder: "{projectPath}", example: "/home/dev/projects/sandbox-demo" },
  { placeholder: "{usedPorts}", example: "3000, 3001" },
];

const promptInputClass = `${inputClass.replace("text-sm", "text-[13px]")} resize-y`;

function AgentPromptBox({ settings, reload }: { settings: Settings; reload: Reload }) {
  const [agentPrompt, setAgentPrompt] = useState(settings.agentPrompt);
  const [promptState, setPromptState] = useState<SaveState>({ kind: "idle" });
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const storedPromptRef = useRef(settings.agentPrompt);
  const isChanged = agentPrompt !== settings.agentPrompt;
  const isOverLimit = agentPrompt.length > agentPromptLimit;
  const isSaving = promptState.kind === "saving";
  const canReset = settings.isAgentPromptEdited || agentPrompt !== settings.defaultAgentPrompt;

  useEffect(() => {
    const previousPrompt = storedPromptRef.current;
    storedPromptRef.current = settings.agentPrompt;
    setAgentPrompt((current) => (current === previousPrompt ? settings.agentPrompt : current));
  }, [settings.agentPrompt]);

  function savePrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isChanged || isOverLimit) return;
    void save({ agentPrompt }, setPromptState, "Prompt saved.", reload);
  }

  async function resetPrompt() {
    setIsConfirmingReset(false);
    const isReset = await save({ agentPrompt: null }, setPromptState, "Prompt reset to default.", reload);
    if (isReset) setAgentPrompt(settings.defaultAgentPrompt);
  }

  return (
    <section className={boxClass} aria-labelledby="agent-prompt-title">
      <div className={boxHeaderClass}>
        <h2 id="agent-prompt-title" className="m-0 text-sm font-semibold">
          Agent prompt
        </h2>
        {settings.isAgentPromptEdited ? <StatusLabel tone="attention">Edited</StatusLabel> : <StatusLabel tone="muted">Default</StatusLabel>}
      </div>
      <form noValidate onSubmit={savePrompt} className="flex flex-col gap-4 p-4">
        <p className="m-0 text-sm text-muted">
          The system prompt the setup agent gets for every project. Placeholders are filled in for each project. Instructions added to a project go after
          this prompt.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted">Placeholders</span>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {placeholderExamples.map((item) => (
              <li key={item.placeholder} className="rounded-md border border-line-muted bg-inset px-2 py-0.5 font-mono text-xs">
                <span className="text-text">{item.placeholder}</span> <span className="text-muted">→ {item.example}</span>
              </li>
            ))}
          </ul>
        </div>
        <label htmlFor="settings-agentPrompt" className="sr-only">
          Agent prompt
        </label>
        <textarea
          id="settings-agentPrompt"
          rows={18}
          className={promptInputClass}
          value={agentPrompt}
          onChange={(event) => {
            setAgentPrompt(event.target.value);
            setPromptState({ kind: "idle" });
          }}
          aria-invalid={isOverLimit || undefined}
          aria-describedby="settings-agentPrompt-count"
          spellCheck={false}
        />
        <div className="flex gap-3 rounded-md border border-warn/40 bg-warn/10 px-4 py-3">
          <WarningIcon size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
          <p className="m-0 text-sm">
            Keep the parts about systemd units, 0.0.0.0, the <code className="font-mono text-[13px]">{"{usedPorts}"}</code> rule and{" "}
            <code className="font-mono text-[13px]">report_services</code>. Without them the agent can block other projects' ports or never report its
            services, and the setup fails.
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="submit" className={primaryButton} disabled={!isChanged || isOverLimit || isSaving}>
              {isSaving ? "Saving" : "Save prompt"}
            </button>
            {isConfirmingReset ? (
              <>
                <button type="button" className={dangerButton} onClick={() => void resetPrompt()} disabled={isSaving}>
                  Reset
                </button>
                <button type="button" className={secondaryButton} onClick={() => setIsConfirmingReset(false)}>
                  Keep prompt
                </button>
              </>
            ) : (
              <button type="button" className={secondaryButton} onClick={() => setIsConfirmingReset(true)} disabled={!canReset || isSaving}>
                <ArrowCounterClockwiseIcon size={16} aria-hidden="true" />
                Reset to default
              </button>
            )}
          </div>
          <span id="settings-agentPrompt-count" className={`font-mono text-xs ${isOverLimit ? "text-danger" : "text-muted"}`}>
            {agentPrompt.length.toLocaleString("en-US")} / {agentPromptLimit.toLocaleString("en-US")}
          </span>
        </div>
        <div role="status">{promptState.kind === "saved" && <Notice>{promptState.message}</Notice>}</div>
        {promptState.kind === "failed" && <ErrorBox title="Prompt not saved">{promptState.message}</ErrorBox>}
      </form>
    </section>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
      <CheckCircleIcon size={16} className="text-success" aria-hidden="true" />
      {children}
    </p>
  );
}
