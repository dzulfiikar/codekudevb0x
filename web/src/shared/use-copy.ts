import { useEffect, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

export function useCopy(text: string): { copyState: CopyState; copy: () => Promise<void> } {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return { copyState, copy };
}
