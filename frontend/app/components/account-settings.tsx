"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useSession } from "./providers/session-provider";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const panel = "rounded-3xl border border-white/[0.07] bg-[#202124]";

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.07] py-3 last:border-0"><dt className="text-xs text-zinc-400">{label}</dt><dd className="truncate text-sm font-semibold">{value}</dd></div>;
}

// "Are you sure?" before deleting; can't be dismissed while the request is running.
function DeleteDialog({ open, deleting, error, onConfirm, onClose }: { open: boolean; deleting: boolean; error: string; onConfirm: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);
  return <dialog ref={dialog} onClose={onClose} onCancel={(event) => { if (deleting) event.preventDefault(); }} aria-labelledby={titleId} className="fixed inset-0 m-auto w-[min(460px,90vw)] rounded-3xl border border-white/10 bg-[#202124] p-7 text-[#f5f3ef] backdrop:bg-black/70">
    <h2 id={titleId} className="text-xl font-bold">Are you sure?</h2>
    <p className="mt-3 text-sm leading-relaxed text-zinc-300">This permanently deletes your account, your tag, and your friends list, and signs you out everywhere. If you&apos;re in a debate, you forfeit it. This can&apos;t be undone.</p>
    <p role="alert" className="mt-3 min-h-4 text-xs text-red-300">{error}</p>
    <div className="mt-4 flex justify-end gap-3">
      <button autoFocus disabled={deleting} onClick={() => dialog.current?.close()} className={`h-11 rounded-xl border border-white/15 px-5 text-sm font-semibold hover:bg-white/5 disabled:opacity-40 ${focus}`}>Keep my account</button>
      <button disabled={deleting} onClick={onConfirm} className={`h-11 rounded-xl bg-[#e53848] px-5 text-sm font-bold text-white enabled:hover:bg-[#c92d3c] disabled:opacity-50 ${focus}`}>{deleting ? "Deleting…" : "Delete my account"}</button>
    </div>
  </dialog>;
}

export default function AccountSettings() {
  const { user, status, refresh } = useSession();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function deleteAccount() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setDeleting(true);
    setError("");
    try {
      await api("/v1/users/me", current.signal, "DELETE");
      await refresh();  // now signed out
      router.replace("/login");
    } catch (err) {
      if (current.signal.aborted) return;
      setError(err instanceof ApiError && err.status === 401 ? "Your session ended. Sign in again to delete your account." : "Couldn’t delete your account. Try again.");
      setDeleting(false);
    }
  }

  return <div className="grid gap-5">
    <section aria-labelledby="account-title" className={`${panel} p-7`}>
      <h2 id="account-title" className="mb-3 text-sm font-bold">Account</h2>
      {status === "loading" ? <p className="text-sm text-zinc-500">Loading…</p> : status === "error" ? <p className="text-sm text-red-300">Couldn’t load your account.</p> : user && <dl>
        <Row label="Tag (permanent)" value={user.tag ?? "Not set yet"} />
        <Row label="Username" value={user.username ?? "Not set"} />
        <Row label="Email" value={user.email ?? "None"} />
      </dl>}
    </section>
    <section aria-labelledby="danger-title" className={`${panel} border-[#e53848]/30 p-7`}>
      <h2 id="danger-title" className="text-sm font-bold text-[#ff7882]">Delete account</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">Permanently remove your account and its data. Signing in with Google again later creates a brand-new account.</p>
      <button disabled={status !== "in"} onClick={() => { setError(""); setConfirming(true); }} className={`mt-5 h-11 rounded-xl border border-[#e53848]/60 px-5 text-sm font-bold text-[#ff7882] enabled:hover:bg-[#e53848]/10 disabled:opacity-40 ${focus}`}>Delete account…</button>
    </section>
    <DeleteDialog open={confirming} deleting={deleting} error={error} onConfirm={deleteAccount} onClose={() => setConfirming(false)} />
  </div>;
}
