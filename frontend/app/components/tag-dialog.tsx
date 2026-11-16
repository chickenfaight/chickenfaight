"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { parseUser, parseTagAvailability, type User, type TagAvailability, tagFormatError } from "../lib/protocol";
import Button from "./button";
import Modal from "./modal";

type Check = TagAvailability | "error";

type Props = {
  onCreated: (user: User) => void;
  onSignOut: () => void;
  signingOut: boolean;
  signOutError: string;
};

export default function TagDialog({ onCreated, onSignOut, signingOut, signOutError }: Props) {
  const submitController = useRef<AbortController | null>(null);
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState<{ value: string; check: Check } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => () => submitController.current?.abort(), []);

  useEffect(() => {
    if (tagFormatError(value)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await api(`/v1/users/tag-availability?tag=${encodeURIComponent(value)}`, controller.signal);
        setChecked({ value, check: parseTagAvailability(data) });
      } catch {
        if (!controller.signal.aborted) setChecked({ value, check: "error" });
      }
    }, 350);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [value]);

  const formatError = value ? tagFormatError(value) : null;
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
      const user = parseUser(await api("/v1/users/me/tag", controller.signal, "PUT", { tag: value }));
      // The lobby stops rendering this dialog once the session has a tag.
      onCreated(user);
    } catch (err) {
      if (controller.signal.aborted) return;
      setSubmitting(false);
      if (err instanceof ApiError && err.code === "TAG_ALREADY_SET") {
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

  // Blocking: Escape is refused, and the only ways out are claiming a tag or signing out.
  return (
    <Modal open blocking title="Pick your tag." eyebrow="One last step" onClose={() => {}}
      description="Opponents and leaderboards will know you by it. Choose carefully: your tag can’t be changed later.">
      <form onSubmit={submit} className="mt-6" noValidate>
        <label htmlFor="tag-input" className="eyebrow mb-2 block">Your tag</label>
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
          className={`h-12 w-full rounded-control border bg-inset px-3 font-mono text-sm text-ink placeholder:text-ink-faint focus-ring ${formatError || taken ? "border-danger/60" : "border-line-strong"}`}
          placeholder="rooster_42"
        />
        <p id="tag-status" aria-live="polite" className={`mt-2 min-h-5 text-xs ${status.tone === "error" ? "text-danger" : status.tone === "ok" ? "text-win" : "text-ink-faint"}`}>
          {status.text}
        </p>
        {submitError && <p role="alert" className="mt-2 text-xs text-danger">{submitError}</p>}
        <Button type="submit" variant="primary" size="lg" disabled={!canSubmit} className="mt-5 w-full">{submitting ? "Saving…" : "Claim tag"}</Button>
      </form>
      <div className="mt-6 flex items-center justify-end border-t border-line pt-4">
        <Button variant="ghost" size="sm" onClick={onSignOut} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</Button>
      </div>
      {signOutError && <p role="alert" className="mt-2 text-right text-xs text-danger">{signOutError}</p>}
    </Modal>
  );
}
