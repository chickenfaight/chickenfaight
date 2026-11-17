"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { tagFormatError } from "../lib/protocol";
import { buttonClass } from "./button";
import { useSession } from "./providers/session-provider";

const fieldClass = "block min-h-12 w-full rounded-control border border-line-strong bg-inset px-4 py-3 text-sm text-ink placeholder:text-ink-faint transition-colors duration-(--duration-fast) hover:border-ink-faint aria-invalid:border-danger/60 focus-ring";
const labelClass = "mt-4 mb-1.5 block text-xs font-semibold text-ink-muted";
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const MAX_USERNAME = 32;

type Field = "tag" | "username" | "password" | "confirm";
type Errors = Partial<Record<Field | "form", string>>;

// Mirrors the server's rules so most mistakes show before submitting; the server re-checks everything.
function localErrors(tag: string, username: string, password: string, confirm: string): Errors {
  const errors: Errors = {};
  const tagError = tagFormatError(tag);
  if (tagError) errors.tag = tagError;
  if (!username.trim()) errors.username = "Choose a username.";
  else if (username.trim().length > MAX_USERNAME) errors.username = `Use ${MAX_USERNAME} characters or fewer.`;
  if (password.length < MIN_PASSWORD) errors.password = `Use at least ${MIN_PASSWORD} characters.`;
  else if (password.length > MAX_PASSWORD) errors.password = `Use ${MAX_PASSWORD} characters or fewer.`;
  if (confirm !== password) errors.confirm = "Passwords don't match.";
  return errors;
}

export default function SignupForm() {
  const controller = useRef<AbortController | null>(null);
  const router = useRouter();
  const { refresh } = useSession();
  const [pending, setPending] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [values, setValues] = useState({ tag: "", username: "", password: "", confirm: "" });
  const [serverErrors, setServerErrors] = useState<Errors>({});

  useEffect(() => () => controller.current?.abort(), []);

  const local = localErrors(values.tag, values.username, values.password, values.confirm);
  const shown = (field: Field) => (touched[field] ? local[field] : undefined) ?? serverErrors[field];

  function update(field: Field, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setServerErrors((previous) => ({ ...previous, [field]: undefined, form: undefined }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    setTouched({ tag: true, username: true, password: true, confirm: true });
    const firstInvalid = (["tag", "username", "password", "confirm"] as const).find((name) => local[name]);
    if (firstInvalid) {
      (form.elements.namedItem(firstInvalid) as HTMLInputElement | null)?.focus();
      return;
    }
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setServerErrors({});
    try {
      await api("/auth/signup", current.signal, "POST", { tag: values.tag, username: values.username.trim(), password: values.password });
      // Signup also signs in; update the app-wide session before leaving.
      if (await refresh() !== "in") throw new Error("Session not established");
      router.replace("/");
    } catch (err) {
      if (current.signal.aborted) return;
      const code = err instanceof ApiError ? err.code ?? "" : "";
      const detail = err instanceof ApiError ? err.detail : undefined;
      setServerErrors(
        code.startsWith("TAG_") ? { tag: detail ?? "That tag can't be used." }
        : code.startsWith("USERNAME_") ? { username: detail ?? "That username can't be used." }
        : err instanceof ApiError && err.status === 429 ? { form: "Too many sign-ups from here. Wait a minute and try again." }
        : { form: "Couldn’t create your account. Try again." },
      );
      setPending(false);
      const invalidField = code.startsWith("TAG_") ? "tag" : code.startsWith("USERNAME_") ? "username" : null;
      if (invalidField) (form.elements.namedItem(invalidField) as HTMLInputElement | null)?.focus();
    }
  }

  function field(name: Field, label: string, props: React.InputHTMLAttributes<HTMLInputElement>, hint?: string) {
    const error = shown(name);
    return <>
      <label htmlFor={`signup-${name}`} className={labelClass}>{label}</label>
      <input
        id={`signup-${name}`} name={name} value={values[name]} className={fieldClass} required
        aria-invalid={Boolean(error)} aria-describedby={`signup-${name}-note`}
        onChange={(event) => update(name, event.target.value)}
        onBlur={() => setTouched((previous) => ({ ...previous, [name]: true }))}
        {...props}
      />
      <p id={`signup-${name}-note`} className={`mt-1 min-h-4 text-xs ${error ? "text-danger" : "text-ink-faint"}`}>{error ?? hint}</p>
    </>;
  }

  return (
    <form
      // Without this, a form submitted before the page's JavaScript loads puts the password in the URL.
      method="post"
      onSubmit={onSubmit} noValidate aria-busy={pending} className="mt-6">
      {field("tag", "Tag", { autoComplete: "username", autoCapitalize: "none", spellCheck: false, maxLength: 64, placeholder: "e.g. Rooster_42" }, "Permanent and unique: 3–24 letters, numbers, or underscores. You sign in with it.")}
      {field("username", "Username", { autoComplete: "nickname", maxLength: 64, placeholder: "How others see you" }, "Shown to other players. You can change it anytime.")}
      {field("password", "Password", { type: "password", autoComplete: "new-password", maxLength: MAX_PASSWORD }, `At least ${MIN_PASSWORD} characters.`)}
      {field("confirm", "Confirm password", { type: "password", autoComplete: "new-password", maxLength: MAX_PASSWORD })}
      <button type="submit" aria-disabled={pending} className={buttonClass("primary", "lg", "mt-2 w-full")}>{pending ? "Creating account…" : "Create account"}</button>
      <p role="alert" className="mt-2 min-h-4 text-xs text-danger">{serverErrors.form}</p>
    </form>
  );
}
