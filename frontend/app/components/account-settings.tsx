"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import Button from "./button";
import ErrorState from "./error-state";
import Modal from "./modal";
import ProfileEditor from "./profile-editor";
import Skeleton from "./skeleton";
import { useSession } from "./providers/session-provider";

// "Are you sure?" before deleting; can't be dismissed while the request is running.
function DeleteDialog({ open, deleting, error, onConfirm, onClose }: { open: boolean; deleting: boolean; error: string; onConfirm: () => void; onClose: () => void }) {
  return <Modal open={open} busy={deleting} onClose={onClose} title="Are you sure?" width="sm">
    <p className="mt-3 text-sm leading-relaxed text-ink-muted">This permanently deletes your account, your tag, and your friends list, and signs you out everywhere. If you&apos;re in a debate, you forfeit it. This can&apos;t be undone.</p>
    <p role="alert" className="mt-3 min-h-4 text-xs text-danger">{error}</p>
    <form method="dialog" className="mt-4 flex justify-end gap-3">
      <Button type="submit" autoFocus disabled={deleting}>Keep my account</Button>
      <Button variant="primary" disabled={deleting} onClick={onConfirm}>{deleting ? "Deleting…" : "Delete my account"}</Button>
    </form>
  </Modal>;
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

  return <div className="grid gap-stack">
    <section aria-labelledby="account-title" className="panel p-panel">
      <h2 id="account-title" className="mb-4 text-sm font-bold">Account</h2>
      {status === "loading" ? <Skeleton label="Loading…" variant="lines" count={3} /> : status === "error" ? <ErrorState compact message="Couldn’t load your account." /> : user && <ProfileEditor user={user} />}
    </section>
    <section aria-labelledby="danger-title" className="panel p-panel">
      <h2 id="danger-title" className="text-sm font-bold">Delete account</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">Permanently remove your account and its data. Signing in with Google again later creates a brand-new account.</p>
      {/* Firefox restores native disabled state on reload before React hydrates. */}
      <Button variant="danger" className="mt-5" aria-disabled={status !== "in"} onClick={() => { if (status !== "in") return; setError(""); setConfirming(true); }}>Delete account…</Button>
    </section>
    <DeleteDialog open={confirming} deleting={deleting} error={error} onConfirm={deleteAccount} onClose={() => setConfirming(false)} />
  </div>;
}
