import { InfoIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toErrorMessage } from "../../shared/api-client";
import type { Project, Workspace } from "../../shared/api-types";
import { ErrorBox } from "../../shared/components/ErrorBox";
import { Field } from "../../shared/components/Field";
import { inputClass, primaryButton, secondaryButton } from "../../shared/components/styles";
import { githubRepositoryUrlPattern, resourceNamePattern } from "../../shared/patterns";
import { isSettingUp } from "./project-status";
import { projectsApi } from "./projects-api";

type ProjectFormErrors = { repoUrl?: string; name?: string };

function nameFromRepoUrl(repoUrl: string): string | undefined {
  return githubRepositoryUrlPattern.exec(repoUrl.trim())?.[2]?.toLowerCase();
}

export function AddProjectDialog({
  workspace,
  isOpen,
  onClose,
  onAdded,
}: {
  workspace: Workspace;
  isOpen: boolean;
  onClose: () => void;
  onAdded: (project: Project) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [name, setName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ProjectFormErrors>({});
  const [submitError, setSubmitError] = useState<string>();
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setRepoUrl("");
      setName("");
      setFieldErrors({});
      setSubmitError(undefined);
      dialog.showModal();
      document.getElementById("project-repoUrl")?.focus();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const suggestedName = nameFromRepoUrl(repoUrl);
  const projectName = name.trim() || suggestedName;
  const usedPorts = workspace.projects.flatMap((project) =>
    project.services.map((service) => ({ ...service, projectName: project.name })),
  );
  const activeProject = workspace.projects.find(isSettingUp);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: ProjectFormErrors = {};
    if (!githubRepositoryUrlPattern.test(repoUrl.trim())) errors.repoUrl = "Enter the full repository URL, like https://github.com/owner/repo";
    if (projectName && !resourceNamePattern.test(projectName)) {
      errors.name = "Use 1 to 40 lowercase letters, numbers and dashes, starting with a letter or number.";
    } else if (projectName && workspace.projects.some((project) => project.name === projectName)) {
      errors.name = `${projectName} already exists in this workspace. Pick another name.`;
    }
    setFieldErrors(errors);
    if (errors.repoUrl || errors.name) {
      document.getElementById(errors.repoUrl ? "project-repoUrl" : "project-name")?.focus();
      return;
    }
    setIsSending(true);
    setSubmitError(undefined);
    try {
      const project = await projectsApi.create(workspace.id, { repoUrl: repoUrl.trim(), name: name.trim() || undefined });
      onAdded(project);
      onClose();
    } catch (caught) {
      setSubmitError(toErrorMessage(caught));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby="add-project-title"
      onClose={onClose}
      className="m-auto w-[560px] max-w-[calc(100vw-32px)] overflow-hidden rounded-md border border-line bg-surface p-0 text-text shadow-[0_12px_40px_#01040999]"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="add-project-title" className="m-0 text-base font-semibold">
          Add project to {workspace.name}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="focus-ring grid size-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted hover:bg-button hover:text-text"
        >
          <XIcon size={16} aria-hidden="true" />
        </button>
      </div>
      <form noValidate onSubmit={(event) => void handleSubmit(event)}>
        <div className="flex flex-col gap-4 p-4">
          <Field id="project-repoUrl" label="GitHub repo" error={fieldErrors.repoUrl}>
            {(props) => (
              <input
                {...props}
                type="url"
                className={inputClass}
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
                placeholder="https://github.com/owner/repo"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <Field
            id="project-name"
            label="Name (optional)"
            error={fieldErrors.name}
            help={projectName ? `Cloned to ~/projects/${projectName}.` : "Leave empty to use the repo name."}
          >
            {(props) => (
              <input
                {...props}
                className={inputClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={suggestedName ?? "repo name"}
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <div className="flex gap-3 rounded-md border border-accent/40 bg-accent/10 px-4 py-3">
            <InfoIcon size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <p className="m-0 font-mono text-[13px]">
                {usedPorts.length > 0
                  ? `Ports in use: ${usedPorts.map((service) => `${service.port} (${service.projectName})`).join(", ")}`
                  : "No ports in use yet"}
              </p>
              <p className="m-0 text-xs text-muted">
                Gemma picks a free one.{" "}
                {workspace.hasGithubToken ? "Uses the workspace's GitHub token." : "No GitHub token, so only public repos clone."}
                {activeProject && ` Starts after ${activeProject.name} finishes.`}
              </p>
            </div>
          </div>
          {submitError && <ErrorBox title="Could not add the project">{submitError}</ErrorBox>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={isSending}>
            {isSending ? "Adding project" : "Add project"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
