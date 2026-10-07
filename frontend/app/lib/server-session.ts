import { headers } from "next/headers";
import { backendUrl } from "./auth";

export type ServerSession = "in" | "out" | "unknown";

// The browser's Cookie header, unchanged. `cookies().toString()` URL-encodes values, which turns the
// session cookie's base64 `=`, `+`, and `/` into `%3D` etc. and breaks the backend's signature check.
export async function forwardedCookie(): Promise<string> {
  return (await headers()).get("cookie") ?? "";
}

// Server Components only. Asks the backend to validate the browser's session cookie;
// the frontend never decides on its own that a session is valid.
export async function serverSession(): Promise<ServerSession> {
  try {
    const response = await fetch(`${backendUrl}/auth/me`, {
      headers: { cookie: await forwardedCookie() },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401) return "out";
    return response.ok ? "in" : "unknown";
  } catch {
    // Backend unreachable: let the page render and show its own error state.
    return "unknown";
  }
}
