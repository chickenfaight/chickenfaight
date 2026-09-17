import type { Metadata } from "next";

type HealthCheck = {
  connected: boolean;
  message: string;
  response: string | null;
};

export const metadata: Metadata = {
  title: "Chickenfaight Health Check",
  description: "Check the connection to the Chickenfaight backend.",
};

async function checkBackend(): Promise<HealthCheck> {
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

  try {
    const response = await fetch(`${backendUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    const responseText = await response.text();
    let data: unknown;

    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }

    const formattedResponse =
      typeof data === "string" ? data : JSON.stringify(data, null, 2);

    if (!response.ok) {
      return {
        connected: false,
        message: `Backend returned HTTP ${response.status}`,
        response: formattedResponse,
      };
    }

    if (
      typeof data !== "object" ||
      data === null ||
      !("status" in data) ||
      data.status !== "healthy"
    ) {
      return {
        connected: false,
        message: "Backend returned an unexpected health response",
        response: formattedResponse,
      };
    }

    return {
      connected: true,
      message: "Backend is healthy",
      response: formattedResponse,
    };
  } catch {
    return {
      connected: false,
      message: "Could not connect to the backend",
      response: null,
    };
  }
}

export default async function HealthPage() {
  const health = await checkBackend();

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <section className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl shadow-black/30">
        <p className="mb-2 text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
          Chickenfaight
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Backend health check
        </h1>

        <div className="mt-8 flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-5">
          <span
            aria-hidden="true"
            className={`h-3 w-3 shrink-0 rounded-full ${
              health.connected
                ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]"
                : "bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.8)]"
            }`}
          />
          <div>
            <p className="font-medium">
              {health.connected ? "Connected" : "Disconnected"}
            </p>
            <p className="mt-1 text-sm text-zinc-400">{health.message}</p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Backend response
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm text-zinc-300">
            {health.response ?? "No response received"}
          </pre>
        </div>

        <p className="mt-6 text-sm leading-6 text-zinc-500">
          Refresh this page to run the check again.
        </p>
      </section>
    </main>
  );
}
