export class ApiError extends Error {
  constructor(
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function readError(response: Response): Promise<ApiError> {
  const fallback =
    response.status === 502 || response.status === 504
      ? "Could not reach the app server on port 8787. Check that it is running."
      : `The server answered ${response.status} ${response.statusText}.`;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ApiError(fallback, undefined);
  }
  if (body && typeof body === "object") {
    const { message, error } = body as { message?: unknown; error?: unknown };
    if (typeof message === "string") return new ApiError(message, body);
    if (typeof error === "string") return new ApiError(error, body);
  }
  return new ApiError(fallback, body);
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return "Could not reach the app server on port 8787. Check that it is running.";
  return error instanceof Error ? error.message : String(error);
}
