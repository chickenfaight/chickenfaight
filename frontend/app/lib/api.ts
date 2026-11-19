import { backendUrl } from "./auth";

export class ApiError extends Error {
  constructor(public status: number, public code?: string, public detail?: string) {
    super(`Request failed (${status})`);
  }
}

export async function api(path: string, signal: AbortSignal | undefined, method = "GET", body?: unknown): Promise<unknown> {
  const timeout = AbortSignal.timeout(5000);
  const response = await fetch(`${backendUrl}${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined;
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data?.code, typeof data?.detail === "string" ? data.detail : undefined);
  return data;
}
