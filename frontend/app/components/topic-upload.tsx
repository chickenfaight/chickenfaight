"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { parseTopicUploadResult } from "../lib/protocol";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const panel = "rounded-3xl border border-white/[0.07] bg-[#202124]";
// Mirrors the server's limit; the server checks it again, along with every line.
const MAX_CHARS = 200_000;
const EXAMPLE = "Food | Is a hot dog a sandwich? | A hot dog is a sandwich. | A hot dog is not a sandwich.";

// Lines the server will read as topics; blank lines and # comments are skipped.
function countTopics(text: string): number {
  return text.split(/\r\n|\r|\n/).filter((line) => line.trim() && !line.trimStart().startsWith("#")).length;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// Paste or load a topic list in the importer's format and add it (POST /v1/admin/topics).
export default function TopicUpload() {
  const router = useRouter();
  const textId = useId();
  const fileId = useId();
  const [text, setText] = useState("");
  const [active, setActive] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const topics = countTopics(text);
  const tooLong = text.length > MAX_CHARS;
  const blocked = uploading || topics === 0 || tooLong;

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setMessage("");
    if (file.size > MAX_CHARS * 4) {
      setError("That file is too large. Upload at most 200,000 characters at a time.");
      return;
    }
    try {
      setText(await file.text());
      setError("");
    } catch {
      setError("Couldn’t read that file.");
    }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setUploading(true);
    setMessage("");
    setError("");
    try {
      const result = parseTopicUploadResult(await api("/v1/admin/topics", current.signal, "POST", { text, is_active: active }));
      setMessage(`Added ${plural(result.added, "topic")}.${result.skipped ? ` Skipped ${result.skipped} already listed.` : ""}`);
      setText("");
      router.refresh();
    } catch (err) {
      if (current.signal.aborted) return;
      setError(err instanceof ApiError && err.code === "TOPICS_INVALID" && err.detail ? `${err.detail} Nothing was added.`
        : err instanceof ApiError && err.status === 401 ? "Your session ended. Sign in again."
        : err instanceof ApiError && err.status === 403 ? "Your account can’t add topics."
        : "Couldn’t upload topics. Try again.");
    } finally {
      if (!current.signal.aborted) setUploading(false);
    }
  }

  return <section aria-labelledby="upload-title" className={`${panel} p-7`}>
    <h2 id="upload-title" className="text-sm font-bold">Upload topics</h2>
    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
      One topic per line: <span className="font-mono text-xs text-zinc-300">category | topic | pro position | con position</span>.
      Each field is 1–255 characters. Blank lines and lines starting with # are skipped, and topics already listed are left alone.
    </p>
    <form method="post" onSubmit={upload} className="mt-5 grid gap-4">
      <label htmlFor={textId} className="sr-only">Topic list</label>
      <textarea id={textId} value={text} onChange={(event) => { setText(event.target.value); setMessage(""); }} autoComplete="off" spellCheck={false} rows={10}
        placeholder={EXAMPLE}
        className={`w-full resize-y rounded-xl border border-white/10 bg-black/30 p-4 font-mono text-xs leading-relaxed text-[#f5f3ef] placeholder:text-zinc-600 ${focus}`} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label htmlFor={fileId} className={`cursor-pointer rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-white/5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-white`}>
          Load a .txt file
          <input id={fileId} type="file" accept=".txt,text/plain" autoComplete="off" className="sr-only"
            onChange={(event) => { void loadFile(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} autoComplete="off" className={`h-4 w-4 accent-[#e53848] ${focus}`} />
          Active right away
        </label>
        <p className={`text-xs ${tooLong ? "text-red-300" : "text-zinc-500"}`}>
          {tooLong ? `Too long: ${text.length.toLocaleString()} of ${MAX_CHARS.toLocaleString()} characters.` : plural(topics, "line") + " to upload"}
        </p>
        <button type="submit" aria-disabled={blocked} className={`ml-auto h-11 rounded-xl bg-[#e53848] px-5 text-sm font-bold text-white transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&:not([aria-disabled=true])]:hover:bg-[#c92d3c] ${focus}`}>
          {uploading ? "Uploading…" : "Upload topics"}
        </button>
      </div>
      <p aria-live="polite" className="min-h-4 text-xs">
        {error ? <span className="text-red-300">{error}</span> : <span className="text-zinc-300">{message}</span>}
      </p>
    </form>
  </section>;
}
