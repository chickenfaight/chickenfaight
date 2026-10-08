"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { backendUrl } from "../lib/auth";
import { useSession } from "./providers/session-provider";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const button = `h-10 rounded-xl border border-white/15 px-4 text-xs font-semibold hover:bg-white/5 disabled:opacity-40 ${focus}`;
const primary = `h-10 rounded-xl bg-[#e53848] px-5 text-sm font-bold text-white enabled:hover:bg-[#c92d3c] disabled:opacity-50 ${focus}`;
const MAX_USERNAME = 32;
const MAX_UPLOAD = 2 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

function Modal({ open, title, onClose, busy, children }: { open: boolean; title: string; onClose: () => void; busy: boolean; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);
  return <dialog ref={dialog} onClose={onClose} onCancel={(event) => { if (busy) event.preventDefault(); }} aria-labelledby={titleId} className="fixed inset-0 m-auto w-[min(440px,90vw)] rounded-3xl border border-white/10 bg-[#202124] p-7 text-[#f5f3ef] backdrop:bg-black/70">
    <h2 id={titleId} className="text-lg font-bold">{title}</h2>
    {open && children}
  </dialog>;
}

// Edit buttons on your own profile: change the username (any time) and the profile picture.
export default function ProfileEditor({ username, avatarUrl }: { username: string | null; avatarUrl: string | null }) {
  const router = useRouter();
  const { refresh } = useSession();
  const [editing, setEditing] = useState<"username" | "picture" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(username ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function open(which: "username" | "picture") {
    setError(""); setName(username ?? ""); setFile(null); setPreview(null); setEditing(which);
  }

  async function run(request: (signal: AbortSignal) => Promise<unknown>, failure: string) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true); setError("");
    try {
      await request(current.signal);
      await refresh();       // header shows the new name or picture
      router.refresh();      // re-render this server-rendered profile
      setEditing(null);
    } catch (err) {
      if (current.signal.aborted) return;
      setError(err instanceof ApiError && err.detail ? err.detail : err instanceof ApiError && err.status === 429 ? "Too many changes. Wait a moment and try again." : failure);
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }

  const nameError = !name.trim() ? "A username can't be empty." : name.trim().length > MAX_USERNAME ? `Use ${MAX_USERNAME} characters or fewer.` : "";

  function saveName(event: FormEvent) {
    event.preventDefault();
    if (nameError) { setError(nameError); return; }
    void run((signal) => api("/v1/users/me", signal, "PATCH", { username: name.trim() }), "Couldn’t change your username. Try again.");
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setError(""); setFile(null); setPreview(null);
    if (!chosen) return;
    if (!TYPES.includes(chosen.type)) { setError("Use a PNG, JPEG, or WebP image."); return; }
    if (chosen.size > MAX_UPLOAD) { setError("Use an image up to 2 MB."); return; }
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
  }

  function upload() {
    if (!file) return;
    void run(async (signal) => {
      // Raw bytes, not JSON, so this skips the JSON helper; the server re-checks and re-encodes.
      const response = await fetch(`${backendUrl}/v1/users/me/avatar`, {
        method: "PUT", body: file, credentials: "include", headers: { "Content-Type": file.type },
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError(response.status, data?.code, typeof data?.detail === "string" ? data.detail : undefined);
      }
    }, "Couldn’t upload your picture. Try again.");
  }

  const custom = avatarUrl?.startsWith("/v1/") ?? false;

  return <>
    <div className="mt-4 flex flex-wrap gap-2">
      <button onClick={() => open("username")} className={button}>Change username</button>
      <button onClick={() => open("picture")} className={button}>Change picture</button>
    </div>
    <Modal open={editing === "username"} title="Change username" onClose={() => setEditing(null)} busy={busy}>
      <form onSubmit={saveName} noValidate>
        <p className="mt-2 text-sm text-zinc-400">Shown to other players. Your tag stays the same.</p>
        <label htmlFor="edit-username" className="mt-5 mb-1.5 block text-xs font-semibold text-zinc-300">Username</label>
        <input id="edit-username" autoFocus value={name} onChange={(event) => { setName(event.target.value); setError(""); }} maxLength={64} autoComplete="nickname" aria-invalid={Boolean(error)} aria-describedby="edit-username-error"
          className={`block min-h-12 w-full rounded-xl border border-white/10 bg-zinc-800 px-4 text-sm ${focus}`} />
        <p id="edit-username-error" role="alert" className="mt-2 min-h-4 text-xs text-red-300">{error}</p>
        <div className="mt-4 flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={() => setEditing(null)} className={button}>Cancel</button>
          <button type="submit" disabled={busy || Boolean(nameError)} className={primary}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
    <Modal open={editing === "picture"} title="Change picture" onClose={() => setEditing(null)} busy={busy}>
      <p className="mt-2 text-sm text-zinc-400">PNG, JPEG, or WebP, up to 2 MB. It&apos;s cropped to a square.</p>
      <div className="mt-5 flex items-center gap-5">
        {preview
          // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview; next/image can't optimize it
          ? <img src={preview} alt="Preview of your new picture" className="h-20 w-20 shrink-0 rounded-full border border-white/10 object-cover" />
          : <span aria-hidden="true" className="h-20 w-20 shrink-0 rounded-full border border-dashed border-white/20" />}
        <label className={`${button} inline-flex cursor-pointer items-center`}>
          Choose image…
          <input type="file" accept={TYPES.join(",")} onChange={choose} className="sr-only" />
        </label>
      </div>
      <p role="alert" className="mt-3 min-h-4 text-xs text-red-300">{error}</p>
      <div className="mt-4 flex flex-wrap justify-end gap-3">
        {custom && <button disabled={busy} onClick={() => void run((signal) => api("/v1/users/me/avatar", signal, "DELETE"), "Couldn’t remove your picture. Try again.")} className={button}>Use Google picture</button>}
        <button disabled={busy} onClick={() => setEditing(null)} className={button}>Cancel</button>
        <button disabled={busy || !file} onClick={upload} className={primary}>{busy ? "Uploading…" : "Upload"}</button>
      </div>
    </Modal>
  </>;
}
