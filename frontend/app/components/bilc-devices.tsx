"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { parseBilcDevices, parsePairingCode, SIZE_CLASS_LABELS, type BilcDevice, type PairingCode } from "../lib/protocol";
import Button, { linkClass } from "./button";
import EmptyState from "./empty-state";
import ErrorState from "./error-state";
import Skeleton from "./skeleton";

const STATUS = {
  idle: { label: "Online", tone: "border-win/35 bg-win/10 text-win" },
  busy: { label: "In a debate", tone: "border-gold/35 bg-gold/10 text-gold" },
  offline: { label: "Offline", tone: "border-line-strong text-ink-faint" },
} as const;
const MODEL = "llama3.2:3b";
const INSTALL = "curl -fsSL https://raw.githubusercontent.com/chickenfaight/chickenfaight/main/bilc/install.sh | sh";
// While a code is showing, look for the new device often; otherwise just keep online dots fresh.
const POLL_PAIRING_MS = 3000;
const POLL_MS = 15000;

function grouped(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function useCountdown(deadline: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000)) : 0;
}

function CommandBlock({ command }: { command: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    if (status !== "copied") return;
    const timer = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return <div className="well overflow-hidden">
    <div className="flex items-center justify-end gap-3 border-b border-line px-3 py-2">
      <span role="status" className={`text-xs ${status === "error" ? "text-danger" : "text-win"}`}>{status === "error" ? "Couldn’t copy. Select the commands below and copy manually." : status === "copied" ? "Copied!" : ""}</span>
      <Button size="sm" className="h-8" onClick={() => void copy()}>Copy</Button>
    </div>
    <pre tabIndex={0} className="overflow-x-auto whitespace-pre px-4 py-3 font-mono text-sm focus-ring"><code className="select-text">{command}</code></pre>
  </div>;
}

// Each command both ways: with BILC installed, or from a checkout of the repo.
function BilcCommands({ setup, args }: { setup?: string; args: string[] }) {
  const block = (program: string) => {
    const command = [...(setup ? [setup] : []), ...args.map((arg) => `${program} ${arg}`)].join("\n");
    return <CommandBlock key={command} command={command} />;
  };
  return <>
    {block("bilc")}
    <p className="mb-2 mt-3 text-ink-muted">Or from source, which needs Go, in the repo’s <span className="font-mono">bilc/</span> folder:</p>
    {block("go run ./cmd/bilc/")}
  </>;
}

function PairPanel({ code, error, creating, onCreate }: { code: PairingCode | null; error: string; creating: boolean; onCreate: () => void }) {
  const left = useCountdown(code?.expires_at ?? null);
  const active = code !== null && left > 0;
  return <section aria-labelledby="pair-title" className="panel p-panel">
    <h2 id="pair-title" className="text-sm font-bold">Pair a device</h2>
    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">BILC connects a model running on your computer to the BYOM arena.</p>
    <ol className="mt-6 grid gap-6 text-sm">
      <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-4"><span className="stat text-3xl text-accent-ink">1</span><div><p className="mb-2 text-ink-muted">Install <a href="https://ollama.com" target="_blank" rel="noreferrer" className={linkClass}>Ollama</a> and get a model:</p><CommandBlock command={`ollama pull ${MODEL}`} /></div></li>
      <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-4"><span className="stat text-3xl text-accent-ink">2</span><div><p className="mb-2 text-ink-muted">Install or update BILC (Linux and macOS). Skip this if you run it from source.</p><CommandBlock command={INSTALL} /></div></li>
      <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-4"><span className="stat text-3xl text-accent-ink">3</span><div>
        <p className="mb-2 text-ink-muted">Get a code, then run these three commands. Each code works once, for 10 minutes.</p>
        {active
          ? <BilcCommands args={[`pair ${grouped(code.code)}`, `model set --model ${MODEL}`, "run"]} />
          // aria-disabled, not disabled: Firefox restores a stale disabled state on reload (frontend/AGENTS.md).
          : <Button variant="primary" onClick={() => { if (!creating) onCreate(); }} aria-disabled={creating}>{creating ? "Getting a code…" : code ? "Get a new code" : "Get pairing code"}</Button>}
        <p aria-live="polite" className="mt-2 min-h-4 text-xs text-ink-faint">
          {error ? <span className="text-danger">{error}</span> : active ? <>Expires in <span className="stat text-base text-ink">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>. Your device shows up below once it pairs.</> : code ? "That code expired." : ""}
        </p>
      </div></li>
    </ol>
    <details className="mt-6 text-sm">
      <summary className="w-fit cursor-pointer rounded-control font-semibold text-ink-muted transition-colors duration-(--duration-fast) hover:text-ink focus-ring">Run two devices on one computer</summary>
      <p className="mb-2 mt-3 max-w-2xl leading-relaxed text-ink-muted">To play a debate against yourself, sign in to a second account in a private window and get a code there. Keep your first <span className="font-mono">bilc run</span> going. In a second terminal, give that device its own config folder, then pair it.</p>
      <BilcCommands setup="export BILC_CONFIG_DIR=/tmp/bilc-b" args={["pair <code> --name device-b", `model set --model ${MODEL}`, "run"]} />
      <p className="mt-2 max-w-2xl leading-relaxed text-ink-muted">Then choose Bring your own model in both windows and join.</p>
    </details>
  </section>;
}

function DeviceRow({ device, onRevoke }: { device: BilcDevice; onRevoke: (id: string) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const status = STATUS[device.status];
  return <li className="flex items-center justify-between gap-4 border-b border-line py-4 last:border-0">
    <div className="flex min-w-0 items-center gap-3">
      <span className={`stat w-24 shrink-0 rounded-control border py-1 text-center text-sm uppercase ${status.tone}`}>{status.label}</span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{device.name}</p>
        <p className="truncate text-xs text-ink-faint">
          {device.model_name ?? "no model reported yet"}{device.size_class && ` (${SIZE_CLASS_LABELS[device.size_class]})`} · {device.platform} · BILC {device.client_version}
          {device.last_seen_at && ` · last seen ${new Date(device.last_seen_at).toLocaleString()}`}
        </p>
      </div>
    </div>
    {confirming
      ? <div className="flex shrink-0 gap-2">
          <Button size="sm" disabled={revoking} onClick={() => setConfirming(false)}>Keep</Button>
          <Button size="sm" variant="primary" disabled={revoking} onClick={async () => { setRevoking(true); await onRevoke(device.id); setRevoking(false); setConfirming(false); }}>{revoking ? "Revoking…" : "Revoke device"}</Button>
        </div>
      : <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>Revoke…</Button>}
  </li>;
}

export default function BilcDevices() {
  const [devices, setDevices] = useState<BilcDevice[] | null>(null);
  const [listError, setListError] = useState("");
  const [code, setCode] = useState<PairingCode | null>(null);
  const [codeError, setCodeError] = useState("");
  const [creating, setCreating] = useState(false);
  const [revokeError, setRevokeError] = useState("");
  // Aborted on unmount. Created in the effect, not once per component: dev Strict Mode runs the
  // cleanup and the effect again right after mounting, which would leave an already-aborted one.
  const mounted = useRef<AbortController | null>(null);
  const signal = () => mounted.current?.signal ?? AbortSignal.abort();

  useEffect(() => {
    const controller = new AbortController();
    mounted.current = controller;
    return () => controller.abort();
  }, []);

  const load = useCallback(async () => {
    const current = mounted.current?.signal ?? AbortSignal.abort();
    try {
      setDevices(parseBilcDevices(await api("/v1/bilc/devices", current)));
      setListError("");
    } catch {
      if (!current.aborted) setListError("Couldn’t load your devices.");
    }
  }, []);

  const pairing = code !== null && Date.parse(code.expires_at) > Date.now();
  useEffect(() => {
    // The first load comes from the timer too, so no state is set synchronously in the effect.
    let timer = setTimeout(function tick() {
      void load();
      timer = setTimeout(tick, pairing ? POLL_PAIRING_MS : POLL_MS);
    }, 0);
    return () => clearTimeout(timer);
  }, [load, pairing]);

  async function createCode() {
    const current = signal();
    setCreating(true);
    setCodeError("");
    try {
      setCode(parsePairingCode(await api("/v1/bilc/pairing-codes", current, "POST")));
    } catch (err) {
      if (current.aborted) return;
      setCodeError(err instanceof ApiError && err.status === 429 ? "Too many codes. Wait a minute and try again." : "Couldn’t get a code. Try again.");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    const current = signal();
    setRevokeError("");
    try {
      await api(`/v1/bilc/devices/${encodeURIComponent(id)}`, current, "DELETE");
      await load();
    } catch {
      if (!current.aborted) setRevokeError("Couldn’t revoke that device. Try again.");
    }
  }

  return <div className="grid gap-stack">
    <PairPanel code={code} error={codeError} creating={creating} onCreate={createCode} />
    <section aria-labelledby="devices-title" className="panel p-panel">
      <div className="flex items-center justify-between">
        <h2 id="devices-title" className="text-sm font-bold">Your devices</h2>
        <Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button>
      </div>
      <p aria-live="polite" className="mt-1 min-h-4 text-xs text-danger">{revokeError}</p>
      {devices === null
        ? (listError ? <ErrorState message={listError} onRetry={() => void load()} /> : <Skeleton label="Loading…" variant="rows" count={2} />)
        : devices.length === 0
          ? (listError ? <ErrorState message={listError} onRetry={() => void load()} /> : <EmptyState title="No devices yet.">Pair one above, and it shows up here.</EmptyState>)
          : <>
              {listError && <ErrorState compact message={listError} onRetry={() => void load()} />}
              <ul>{devices.map((device) => <DeviceRow key={device.id} device={device} onRevoke={revoke} />)}</ul>
              <p className="mt-3 text-xs text-ink-faint">Revoking disconnects the device and stops it from connecting again. Only you can see this list.</p>
            </>}
    </section>
  </div>;
}
