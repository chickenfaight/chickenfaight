import { backendUrl } from "./auth";

export class ApiError extends Error {
  constructor(public status: number, public code?: string) {
    super(`Request failed (${status})`);
  }
}

export async function api(path: string, signal: AbortSignal, method = "GET"): Promise<unknown> {
  const response = await fetch(`${backendUrl}${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
  });
  if (response.status === 204) return undefined;
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data?.code);
  return data;
}
