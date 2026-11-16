"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { backendUrl } from "../lib/auth";
import { parseUser, type User } from "../lib/protocol";
import Avatar from "./avatar";
import Button, { buttonClass } from "./button";
import Modal from "./modal";
import { useSession } from "./providers/session-provider";

const editValue = "max-w-full cursor-pointer truncate rounded-sm underline-offset-4 transition-colors duration-(--duration-fast) hover:text-accent-ink hover:underline focus-visible:text-accent-ink focus-visible:underline focus-ring";
const MAX_USERNAME = 32;
const MAX_UPLOAD = 2 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 border-b border-line py-3.5 last:border-0">
    <dt className="shrink-0 text-xs text-ink-muted">{label}</dt>
    <dd className="min-w-0 text-right text-sm font-semibold">{children}</dd>
  </div>;
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
      <button type="button" onClick={() => open("picture")} aria-label="Edit profile picture" aria-haspopup="dialog" className="group relative shrink-0 cursor-pointer rounded-full transition-transform duration-(--duration-fast) active:scale-[0.97] focus-ring">
        <Avatar name={name} url={user.avatar_url} size={96} />
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center rounded-full bg-black/70 text-xs font-bold text-white opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 group-focus-visible:opacity-100">Edit picture</span>
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
    <Modal open={editing === "username" || editingEmail} title={`Change ${fieldLabel.toLowerCase()}`} onClose={() => setEditing(null)} busy={busy} width="sm">
      <form method="post" onSubmit={saveDetails}>
        <p className="mt-2 text-sm text-ink-muted">{editingEmail ? "Only you can see this. Leave it blank to remove it." : "Shown to other players. Your tag stays the same."}</p>
        <label htmlFor="edit-account-detail" className="mt-5 mb-1.5 block text-xs font-semibold text-ink-muted">{fieldLabel}</label>
        <input id="edit-account-detail" type={editingEmail ? "email" : "text"} autoFocus value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }}
          maxLength={editingEmail ? 320 : 64} autoComplete={editingEmail ? "email" : "nickname"} aria-invalid={Boolean(error)} aria-describedby="edit-account-error"
          className="block min-h-12 w-full rounded-control border border-line-strong bg-inset px-4 text-sm text-ink transition-colors duration-(--duration-fast) hover:border-ink-faint aria-invalid:border-danger/60 focus-ring" />
        <p id="edit-account-error" role="alert" className="mt-2 min-h-4 text-xs text-danger">{error}</p>
        <div className="mt-4 flex justify-end gap-3">
          <Button disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || Boolean(nameError)}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
    <Modal open={editing === "picture"} title="Change picture" onClose={() => setEditing(null)} busy={busy} width="sm">
      <p className="mt-2 text-sm text-ink-muted">PNG, JPEG, or WebP, up to 2 MB. It&apos;s cropped to a square.</p>
      <div className="mt-5 flex items-center gap-5">
        {preview
          // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview; next/image can't optimize it
          ? <img src={preview} alt="Preview of your new picture" className="h-20 w-20 shrink-0 rounded-full border border-line-strong object-cover" />
          : <Avatar name={name} url={user.avatar_url} size={80} />}
        <label className={buttonClass("secondary", "md", "cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-ink")}>
          Choose image…
          <input type="file" accept={TYPES.join(",")} onChange={choose} className="sr-only" />
        </label>
      </div>
      <p role="alert" className="mt-3 min-h-4 text-xs text-danger">{error}</p>
      <div className="mt-4 flex flex-wrap justify-end gap-3">
        {custom && <Button variant="danger" disabled={busy} onClick={() => void run((signal) => api("/v1/users/me/avatar", signal, "DELETE"), "Couldn’t remove your picture. Try again.")}>Remove picture</Button>}
        <Button disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
        <Button variant="primary" disabled={busy || !file} onClick={upload}>{busy ? "Uploading…" : "Upload"}</Button>
      </div>
    </Modal>
  </>;
}
