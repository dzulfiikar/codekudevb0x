import { CheckCircleIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react";
import type { CheckStatus, HostCheck } from "../api";
import type { LabelTone } from "../ui";

const statusName: Record<CheckStatus, string> = {
  ok: "Passed",
  warn: "Warning",
  fail: "Failed",
};

const detailTone: Record<CheckStatus, string> = {
  ok: "text-muted",
  warn: "text-warn",
  fail: "text-danger",
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function summarizeCheck(check: HostCheck): { text: string; label: string; tone: LabelTone } {
  const failures = check.checks.filter((item) => item.status === "fail").length;
  const warnings = check.checks.filter((item) => item.status === "warn").length;
  if (!check.ready || failures > 0) {
    return {
      text: [failures > 0 && `${failures} failed`, warnings > 0 && plural(warnings, "warning")].filter(Boolean).join(", "),
      label: "Not ready",
      tone: "danger",
    };
  }
  if (warnings > 0) return { text: plural(warnings, "warning"), label: "Ready", tone: "attention" };
  return { text: `${plural(check.checks.length, "check")} passed`, label: "Ready", tone: "success" };
}

export function formatTimeAgo(isoTime: string): string {
  const minutes = Math.floor((Date.now() - new Date(isoTime).getTime()) / 60000);
  if (Number.isNaN(minutes)) return "at an unknown time";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${plural(Math.floor(hours / 24), "day")} ago`;
}

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "ok") return <CheckCircleIcon size={16} className="shrink-0 text-success" aria-hidden="true" />;
  if (status === "warn") return <WarningIcon size={16} className="shrink-0 text-warn" aria-hidden="true" />;
  return <XCircleIcon size={16} className="shrink-0 text-danger" aria-hidden="true" />;
}

export function HostChecklist({ check }: { check: HostCheck }) {
  return (
    <ul className="m-0 list-none p-0">
      {check.checks.map((item) => (
        <li key={item.id} className="flex items-start gap-3 border-t border-line-muted px-4 py-2.5 first:border-t-0">
          <span className="pt-0.5">
            <StatusIcon status={item.status} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm">
                <span className="sr-only">{statusName[item.status]}: </span>
                {item.label}
              </span>
              <span className={`text-right font-mono text-xs break-all ${detailTone[item.status]}`}>{item.detail}</span>
            </div>
            {item.status !== "ok" && item.fix && <span className="text-xs leading-5 text-muted">{item.fix}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
