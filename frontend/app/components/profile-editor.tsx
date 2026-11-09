"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { backendUrl } from "../lib/auth";
import { parseUser, type User } from "../lib/protocol";
import Avatar from "./avatar";
import { useSession } from "./providers/session-provider";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const button = `h-10 rounded-xl border border-white/15 px-4 text-xs font-semibold hover:bg-white/5 disabled:opacity-40 ${focus}`;
const primary = `h-10 rounded-xl bg-[#e53848] px-5 text-sm font-bold text-white enabled:hover:bg-[#c92d3c] disabled:opacity-50 ${focus}`;
const editValue = `max-w-full cursor-pointer truncate rounded-sm underline-offset-4 hover:text-[#ff7882] hover:underline focus-visible:text-[#ff7882] focus-visible:underline ${focus}`;
const MAX_USERNAME = 32;
const MAX_UPLOAD = 2 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.07] py-3 last:border-0">
    <dt className="shrink-0 text-xs text-zinc-400">{label}</dt>
    <dd className="min-w-0 text-right text-sm font-semibold">{children}</dd>
  </div>;
}

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

export default function ProfileEditor({ user }: { user: User }) {
  const router = useRouter();
  const { setUser } = useSession();
  const [editing, setEditing] = useState<"username" | "email" | "picture" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function open(which: "username" | "email" | "picture") {
    setError("");
    setDraft(which === "picture" ? "" : user[which] ?? "");
    setFile(null);
    setPreview(null);
    setEditing(which);
  }

  async function run(request: (signal: AbortSignal) => Promise<unknown>, failure: string) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true); setError("");
    try {
      const updated = parseUser(await request(current.signal));
      if (current.signal.aborted) return;
      setUser(updated);
      router.refresh();
      setEditing(null);
    } catch (err) {
      if (current.signal.aborted) return;
      if (editing === "email" && err instanceof ApiError && err.status === 422) {
        setError("Enter a valid email address.");
      } else {
        setError(err instanceof ApiError && err.detail ? err.detail : failure);
      }
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }

  const value = draft.trim();
  const editingEmail = editing === "email";
  const fieldLabel = editingEmail ? "Email" : "Username";
  const nameError = editing === "username" && (!value || Array.from(value).length > MAX_USERNAME);

  function saveDetails(event: FormEvent) {
    event.preventDefault();
    if (busy || nameError) return;
    const update = editingEmail ? { email: value || null } : { username: value };
    void run((signal) => api("/v1/users/me", signal, "PATCH", update), `Couldn’t change your ${fieldLabel.toLowerCase()}. Try again.`);
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
      return response.json();
    }, "Couldn’t upload your picture. Try again.");
  }

  const custom = user.avatar_url?.startsWith("/v1/") ?? false;
  const name = user.username || user.tag || "Player";

  return <>
    <div className="flex items-center gap-6">
      <button type="button" onClick={() => open("picture")} aria-label="Edit profile picture" aria-haspopup="dialog" className={`group relative shrink-0 cursor-pointer rounded-full ${focus}`}>
        <Avatar name={name} url={user.avatar_url} size={96} />
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center rounded-full bg-black/70 text-xs font-bold text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">Edit picture</span>
      </button>
      <dl className="min-w-0 flex-1">
        <Row label="Tag (permanent)"><span className="block truncate">{user.tag ?? "Not set yet"}</span></Row>
        <Row label="Username">
          <button type="button" onClick={() => open("username")} aria-label={`Edit username: ${user.username ?? "Not set"}`} aria-haspopup="dialog" className={editValue}>{user.username ?? "Not set"}</button>
        </Row>
        <Row label="Email">
          <button type="button" onClick={() => open("email")} aria-label={`Edit email: ${user.email ?? "None"}`} aria-haspopup="dialog" className={editValue}>{user.email ?? "None"}</button>
        </Row>
      </dl>
    </div>
    <Modal open={editing === "username" || editingEmail} title={`Change ${fieldLabel.toLowerCase()}`} onClose={() => setEditing(null)} busy={busy}>
      <form method="post" onSubmit={saveDetails}>
        <p className="mt-2 text-sm text-zinc-400">{editingEmail ? "Only you can see this. Leave it blank to remove it." : "Shown to other players. Your tag stays the same."}</p>
        <label htmlFor="edit-account-detail" className="mt-5 mb-1.5 block text-xs font-semibold text-zinc-300">{fieldLabel}</label>
        <input id="edit-account-detail" type={editingEmail ? "email" : "text"} autoFocus value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }}
          maxLength={editingEmail ? 320 : 64} autoComplete={editingEmail ? "email" : "nickname"} aria-invalid={Boolean(error)} aria-describedby="edit-account-error"
          className={`block min-h-12 w-full rounded-xl border border-white/10 bg-zinc-800 px-4 text-sm ${focus}`} />
        <p id="edit-account-error" role="alert" className="mt-2 min-h-4 text-xs text-red-300">{error}</p>
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
          : <Avatar name={name} url={user.avatar_url} size={80} />}
        <label className={`${button} inline-flex cursor-pointer items-center`}>
          Choose image…
          <input type="file" accept={TYPES.join(",")} onChange={choose} className="sr-only" />
        </label>
      </div>
      <p role="alert" className="mt-3 min-h-4 text-xs text-red-300">{error}</p>
      <div className="mt-4 flex flex-wrap justify-end gap-3">
        {custom && <button disabled={busy} onClick={() => void run((signal) => api("/v1/users/me/avatar", signal, "DELETE"), "Couldn’t remove your picture. Try again.")} className={button}>Remove picture</button>}
        <button disabled={busy} onClick={() => setEditing(null)} className={button}>Cancel</button>
        <button disabled={busy || !file} onClick={upload} className={primary}>{busy ? "Uploading…" : "Upload"}</button>
      </div>
    </Modal>
  </>;
}
