"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { parseUser, parseUsernameAvailability, type User, type UsernameAvailability, usernameFormatError } from "../lib/protocol";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
type Check = UsernameAvailability | "error";

type Props = {
  onCreated: (user: User) => void;
  onSignOut: () => void;
  signingOut: boolean;
  signOutError: string;
};

export default function UsernameDialog({ onCreated, onSignOut, signingOut, signOutError }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const created = useRef(false);
  const submitController = useRef<AbortController | null>(null);
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState<{ value: string; check: Check } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
    return () => submitController.current?.abort();
  }, []);

  useEffect(() => {
    if (usernameFormatError(value)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await api(`/v1/users/username-availability?username=${encodeURIComponent(value)}`, controller.signal);
        setChecked({ value, check: parseUsernameAvailability(data) });
      } catch {
        if (!controller.signal.aborted) setChecked({ value, check: "error" });
      }
    }, 350);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [value]);

  const formatError = value ? usernameFormatError(value) : null;
  const check = checked?.value === value ? checked.check : null;
  const taken = check !== null && check !== "error" && !check.available;
  const canSubmit = value !== "" && !formatError && !taken && !submitting;

  const status = !value ? { tone: "faint", text: "3–24 characters: letters, numbers, and underscores." }
    : formatError ? { tone: "error", text: formatError }
    : check === null ? { tone: "faint", text: "Checking availability…" }
    : check === "error" ? { tone: "faint", text: "Couldn’t check availability. You can still try it." }
    : check.available ? { tone: "ok", text: "That tag is available." }
    : { tone: "error", text: check.detail };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError("");
    const controller = new AbortController();
    submitController.current = controller;
    try {
      const user = parseUser(await api("/v1/users/me", controller.signal, "PATCH", { username: value }));
      created.current = true;
      dialog.current?.close();
      onCreated(user);
    } catch (err) {
      if (controller.signal.aborted) return;
      setSubmitting(false);
      if (err instanceof ApiError && err.code === "USERNAME_ALREADY_SET") {
        setSubmitError("Your tag is already set. Reload the page to continue.");
      } else if (err instanceof ApiError && err.detail && (err.status === 409 || err.status === 422)) {
        setChecked({ value, check: { available: false, detail: err.detail } });
      } else if (err instanceof ApiError && err.status === 401) {
        setSubmitError("Your session expired. Sign out and sign in again.");
      } else {
        setSubmitError("Couldn’t save your tag. Try again.");
      }
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="tag-title"
      aria-describedby="tag-description"
      onCancel={(event) => event.preventDefault()}
      onClose={() => { if (!created.current) dialog.current?.showModal(); }}
      className="fixed inset-0 m-auto w-[min(480px,90vw)] rounded-3xl border border-white/10 bg-[#202124] p-8 text-[#f5f3ef] backdrop:bg-black/80"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#ff7882]">One last step</p>
      <h2 id="tag-title" className="mt-3 text-2xl font-bold tracking-[-0.045em]">Pick your tag.</h2>
      <p id="tag-description" className="mt-3 text-sm leading-6 text-zinc-400">
        Opponents and leaderboards will know you by it. Choose carefully: your tag can’t be changed later.
      </p>
      <form onSubmit={submit} className="mt-6" noValidate>
        <label htmlFor="tag-input" className="mb-2 block text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Your tag</label>
        <input
          id="tag-input"
          autoFocus
          value={value}
          onChange={(event) => { setValue(event.target.value); setSubmitError(""); }}
          maxLength={24}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={Boolean(formatError) || taken}
          aria-describedby="tag-status"
          className={`h-12 w-full rounded-xl border bg-[#242529] px-3 font-mono text-sm text-[#f5f3ef] placeholder:text-zinc-600 ${focus} ${formatError || taken ? "border-red-400/50" : "border-white/10"}`}
          placeholder="rooster_42"
        />
        <p id="tag-status" aria-live="polite" className={`mt-2 min-h-5 text-xs ${status.tone === "error" ? "text-red-300" : status.tone === "ok" ? "text-emerald-400" : "text-zinc-500"}`}>
          {status.text}
        </p>
        {submitError && <p role="alert" className="mt-2 text-xs text-red-300">{submitError}</p>}
        <button
          type="submit"
          disabled={!canSubmit}
          className={`mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-[#e53848] text-sm font-bold text-white transition-colors enabled:hover:bg-[#c92d3c] disabled:cursor-not-allowed disabled:opacity-50 ${focus}`}
        >
          {submitting ? "Saving…" : "Claim tag"}
        </button>
      </form>
      <div className="mt-6 flex items-center justify-between border-t border-white/[0.07] pt-4 text-xs">
        <span className="text-zinc-500">Not you?</span>
        <button type="button" onClick={onSignOut} disabled={signingOut} className={`rounded-xl text-zinc-400 transition-colors hover:text-white disabled:opacity-50 ${focus}`}>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
      {signOutError && <p role="alert" className="mt-2 text-right text-xs text-red-300">{signOutError}</p>}
    </dialog>
  );
}
