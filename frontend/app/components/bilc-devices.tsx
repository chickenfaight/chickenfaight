"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { parseBilcDevices, parsePairingCode, SIZE_CLASS_LABELS, type BilcDevice, type PairingCode } from "../lib/protocol";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const panel = "rounded-3xl border border-white/[0.07] bg-[#202124]";
const inset = "rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-sm";
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

function PairPanel({ code, error, creating, onCreate }: { code: PairingCode | null; error: string; creating: boolean; onCreate: () => void }) {
  const left = useCountdown(code?.expires_at ?? null);
  const active = code !== null && left > 0;
  return <section aria-labelledby="pair-title" className={`${panel} p-7`}>
    <h2 id="pair-title" className="text-sm font-bold">Pair a device</h2>
    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">BILC connects a model running on your computer to the BYOM arena. Install it, then pair it with a one-time code.</p>
    <ol className="mt-5 grid gap-4 text-sm">
      <li><p className="mb-2 text-zinc-300">1. Install or update BILC (Linux and macOS):</p><p className={`${inset} select-all break-all`}>{INSTALL}</p></li>
      <li>
        <p className="mb-2 text-zinc-300">2. Get a code and pair. Each code works once, for 10 minutes.</p>
        {active
          ? <p className={`${inset} select-all`}>bilc pair {grouped(code.code)}</p>
          // aria-disabled, not disabled: Firefox restores a stale disabled state on reload (frontend/AGENTS.md).
          : <button onClick={() => { if (!creating) onCreate(); }} aria-disabled={creating} className={`h-11 rounded-xl bg-[#e53848] px-5 text-sm font-bold text-white hover:bg-[#c92d3c] aria-disabled:opacity-50 aria-disabled:hover:bg-[#e53848] ${focus}`}>{creating ? "Getting a code…" : code ? "Get a new code" : "Get pairing code"}</button>}
        <p aria-live="polite" className="mt-2 min-h-4 text-xs text-zinc-500">
          {error ? <span className="text-red-300">{error}</span> : active ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}. Your device shows up below once it pairs.` : code ? "That code expired." : ""}
        </p>
      </li>
      <li><p className="mb-2 text-zinc-300">3. Choose your local model and connect:</p><p className={inset}>bilc model set --model llama3.2:3b<br />bilc run</p></li>
    </ol>
  </section>;
}

function DeviceRow({ device, onRevoke }: { device: BilcDevice; onRevoke: (id: string) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  return <li className="flex items-center justify-between gap-4 border-b border-white/[0.07] py-4 last:border-0">
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${device.online ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" : "bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.8)]"}`} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{device.name} <span className="font-normal text-zinc-500">· {device.status === "busy" ? "in a debate" : device.status === "idle" ? "online" : "offline"}</span></p>
        <p className="truncate text-xs text-zinc-500">
          {device.model_name ?? "no model reported yet"}{device.size_class && ` (${SIZE_CLASS_LABELS[device.size_class]})`} · {device.platform} · BILC {device.client_version}
          {device.last_seen_at && ` · last seen ${new Date(device.last_seen_at).toLocaleString()}`}
        </p>
      </div>
    </div>
    {confirming
      ? <div className="flex shrink-0 gap-2">
          <button disabled={revoking} onClick={() => setConfirming(false)} className={`h-9 rounded-xl border border-white/15 px-4 text-xs font-semibold hover:bg-white/5 disabled:opacity-40 ${focus}`}>Keep</button>
          <button disabled={revoking} onClick={async () => { setRevoking(true); await onRevoke(device.id); setRevoking(false); setConfirming(false); }}
            className={`h-9 rounded-xl bg-[#e53848] px-4 text-xs font-bold text-white enabled:hover:bg-[#c92d3c] disabled:opacity-50 ${focus}`}>{revoking ? "Revoking…" : "Revoke device"}</button>
        </div>
      : <button onClick={() => setConfirming(true)} className={`h-9 shrink-0 rounded-xl border border-[#e53848]/60 px-4 text-xs font-bold text-[#ff7882] hover:bg-[#e53848]/10 ${focus}`}>Revoke…</button>}
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

  return <div className="grid gap-5">
    <PairPanel code={code} error={codeError} creating={creating} onCreate={createCode} />
    <section aria-labelledby="devices-title" className={`${panel} p-7`}>
      <div className="flex items-center justify-between">
        <h2 id="devices-title" className="text-sm font-bold">Your devices</h2>
        <button onClick={() => void load()} className={`text-xs text-zinc-400 transition-colors hover:text-white ${focus}`}>Refresh</button>
      </div>
      <p aria-live="polite" className="mt-1 min-h-4 text-xs text-red-300">{revokeError}</p>
      {devices === null
        ? <p className="text-sm text-zinc-500">{listError || "Loading…"}</p>
        : devices.length === 0
          ? <p className="text-sm text-zinc-500">{listError || "No devices yet. Pair one above."}</p>
          : <>
              {listError && <p className="text-xs text-red-300">{listError}</p>}
              <ul>{devices.map((device) => <DeviceRow key={device.id} device={device} onRevoke={revoke} />)}</ul>
              <p className="mt-3 text-xs text-zinc-500">Revoking disconnects the device and stops it from connecting again. Only you can see this list.</p>
            </>}
    </section>
  </div>;
}
