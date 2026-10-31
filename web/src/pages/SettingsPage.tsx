import { CheckCircleIcon, KeyIcon, PlugsConnectedIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, errorMessage, type KeyTestResult, type SettingsUpdate } from "../api";
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
  useResource,
} from "../ui";
import { Field } from "./Field";

const selectClass = `${inputClass} select-chevron`;

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; message: string } | { kind: "failed"; message: string };

export function SettingsPage() {
  const settings = useResource(api.getSettings, "settings");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [primaryModel, setPrimaryModel] = useState("");
  const [fallbackModel, setFallbackModel] = useState("");
  const [fallbackError, setFallbackError] = useState<string>();
  const [testResult, setTestResult] = useState<KeyTestResult>();
  const [isTesting, setIsTesting] = useState(false);
  const [keyState, setKeyState] = useState<SaveState>({ kind: "idle" });
  const [modelState, setModelState] = useState<SaveState>({ kind: "idle" });
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const loaded = settings.data;

  useEffect(() => {
    if (!loaded) return;
    setPrimaryModel(loaded.primaryModel);
    setFallbackModel(loaded.fallbackModel ?? "");
  }, [loaded]);

  if (settings.isLoading) {
    return (
      <Page>
        <LoadingText>Loading settings</LoadingText>
      </Page>
    );
  }

  if (!loaded) {
    return (
      <Page>
        <ErrorBox title="Could not load settings">
          {settings.error}{" "}
          <button type="button" onClick={() => void settings.reload()} className="focus-ring cursor-pointer rounded-sm bg-transparent p-0 font-semibold text-accent">
            Try again
          </button>
        </ErrorBox>
      </Page>
    );
  }

  const modelOptions = loaded.availableModels.some((model) => model.id === loaded.primaryModel)
    ? loaded.availableModels
    : [...loaded.availableModels, { id: loaded.primaryModel, displayName: `${loaded.primaryModel} (not in the model list)` }];
  const hasKey = loaded.geminiApiKeySource === "database";
  const typedKey = geminiApiKey.trim();

  async function save(update: SettingsUpdate, setState: (state: SaveState) => void, savedMessage: string) {
    setState({ kind: "saving" });
    try {
      await api.updateSettings(update);
      await settings.reload();
      setState({ kind: "saved", message: savedMessage });
    } catch (caught) {
      setState({ kind: "failed", message: errorMessage(caught) });
    }
  }

  async function testKey() {
    setIsTesting(true);
    setTestResult(undefined);
    try {
      setTestResult(await api.testGeminiKey(typedKey || undefined));
    } catch (caught) {
      setTestResult({ ok: false, message: errorMessage(caught) });
    } finally {
      setIsTesting(false);
    }
  }

  async function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded || !typedKey) return;
    await save({ geminiApiKey: typedKey, primaryModel: loaded.primaryModel, fallbackModel: loaded.fallbackModel }, setKeyState, "Key saved.");
    setGeminiApiKey("");
    setTestResult(undefined);
  }

  function removeKey() {
    if (!loaded) return;
    setIsConfirmingRemove(false);
    setTestResult(undefined);
    void save(
      { geminiApiKey: "", primaryModel: loaded.primaryModel, fallbackModel: loaded.fallbackModel },
      setKeyState,
      "Key removed. Projects cannot be set up until you add a new one.",
    );
  }

  function saveModels(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fallbackModel && fallbackModel === primaryModel) {
      setFallbackError("Pick a different fallback, or None.");
      document.getElementById("settings-fallbackModel")?.focus();
      return;
    }
    setFallbackError(undefined);
    void save({ primaryModel, fallbackModel: fallbackModel || null }, setModelState, "Models saved.");
  }

  return (
    <Page>
      <div className="grid grid-cols-2 items-start gap-6">
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
                  Key ending <span className="ml-1 font-mono">{loaded.geminiApiKeyHint ?? "unknown"}</span>
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

        <section className={boxClass} aria-labelledby="models-title">
          <div className={boxHeaderClass}>
            <h2 id="models-title" className="m-0 text-sm font-semibold">
              Models
            </h2>
          </div>
          <form noValidate onSubmit={saveModels} className="flex flex-col gap-4 p-4">
            {loaded.availableModels.length === 0 && (
              <p className="m-0 text-xs text-muted">No Gemma models came back. Check the key, then reload this page.</p>
            )}
            <Field id="settings-primaryModel" label="Primary" help="Used for every project setup.">
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
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              id="settings-fallbackModel"
              label="Fallback"
              help="Takes over when the primary hits its rate limit. Pick None to only wait."
              error={fallbackError}
            >
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
                  {loaded.availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
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
      </div>

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
                  <td className="px-4 py-2 font-mono text-xs">{loaded.primaryModel}</td>
                  <td className="px-4 py-2">Waits for the time the API asks, then retries</td>
                </tr>
                <tr className="border-t border-line-muted">
                  <td className="px-4 py-2 font-mono text-xs">{loaded.fallbackModel ?? "None"}</td>
                  <td className="px-4 py-2">{loaded.fallbackModel ? "Used while the primary waits" : "No fallback. The agent only waits."}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="m-0 text-sm text-muted">On the free tier, most setup time is waiting for the per-minute limit to reset.</p>
        </div>
      </section>
    </Page>
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

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-10 pt-6 pb-10">
      <div>
        <h1 className="m-0 text-2xl font-semibold">Settings</h1>
        <p className="mt-1 mb-0 text-sm text-muted">Gemini key and models for the setup agent. Changes apply to the next project.</p>
      </div>
      {children}
    </div>
  );
}
