"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { backendUrl } from "../lib/auth";
import { parseArenas, type Arena } from "../lib/protocol";
import { preferredArena, saveSelectedArena } from "../lib/selected-arena";
import Button, { linkClass } from "./button";
import Skeleton from "./skeleton";
import EmptyState from "./empty-state";
import ErrorState from "./error-state";
// Mirrors the server's caps (PROTOCOL.md, POST /v1/tips/chat).
const MAX_MESSAGE = 2000;
const MAX_CONVERSATION = 8000;
const MAX_MESSAGES = 20;

type Message = { role: "user" | "assistant"; content: string };

// A conversation with the selected model acting as a debate coach. Kept only in this page.
export default function TipsChat() {
  const router = useRouter();
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [modelId, setModelId] = useState("");
  const [tips, setTips] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const load = new AbortController();
    async function fetchAll() {
      try {
        const [list, tipData] = await Promise.all([api("/v1/arenas", load.signal), api("/v1/tips", load.signal)]);
        if (load.signal.aborted) return;
        const parsed = parseArenas(list);
        setArenas(parsed);
        setModelId(preferredArena(parsed));
        const tipList = (tipData as { tips?: unknown })?.tips;
        setTips(Array.isArray(tipList) ? tipList.filter((tip): tip is string => typeof tip === "string") : []);
        setLoaded(true);
      } catch (err) {
        if (load.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) { router.replace("/login"); return; }
        setLoadError("Couldn’t load your coach and tips.");
      }
    }
    void fetchAll();
    return () => { load.abort(); controller.current?.abort(); };
  }, [router, attempt]);

  useEffect(() => {
    if (followReply.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages]);

  const used = messages.reduce((sum, message) => sum + message.content.length, 0);
  const remaining = Math.max(0, Math.min(MAX_MESSAGE, MAX_CONVERSATION - used));
  const full = remaining === 0 || messages.length + 1 > MAX_MESSAGES;
  const overBudget = draft.trim().length > remaining;

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming || !modelId || full) return;
    if (content.length > remaining) {
      setError(`Keep your question to ${remaining.toLocaleString()} characters for this conversation, or start a new chat.`);
      return;
    }
    const conversation: Message[] = [...messages, { role: "user", content }];
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    followReply.current = true;
    setMessages([...conversation, { role: "assistant", content: "" }]);
    setDraft(""); setError(""); setStreaming(true);
    try {
      const response = await fetch(`${backendUrl}/v1/tips/chat`, {
        method: "POST", credentials: "include", signal: current.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId, messages: conversation }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError(response.status, data?.code, typeof data?.detail === "string" ? data.detail : undefined);
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        setMessages((previous) => [...previous.slice(0, -1), { role: "assistant", content: previous[previous.length - 1].content + value }]);
      }
    } catch (err) {
      if (current.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) { router.replace("/login"); return; }
      // Drop the unanswered turn so the conversation stays valid; put the text back to retry.
      setMessages(messages);
      setDraft(content);
      setError(err instanceof ApiError && err.status === 429 ? "You’re asking quickly. Wait a moment and try again."
        : err instanceof ApiError && err.detail ? err.detail : "Couldn’t reach the coach. Try again.");
    } finally {
      if (!current.signal.aborted) setStreaming(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  function restart() {
    controller.current?.abort();
    setMessages([]); setDraft(""); setError(""); setStreaming(false);
    requestAnimationFrame(() => input.current?.focus());
  }

  const playable = arenas.filter((arena) => arena.kind === "provided");

  if (loadError) return <ErrorState message={loadError} onRetry={() => { setLoadError(""); setAttempt(value => value + 1); }} />;
  if (loaded && !playable.length) return <EmptyState title="No coaching models available">Try again later when a provided model is available.</EmptyState>;

  return <div className="grid items-start gap-stack xl:grid-cols-[minmax(0,1fr)_300px]">
    <section aria-labelledby="chat-title" className="panel flex min-w-0 flex-col p-panel">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 id="chat-title" className="text-sm font-bold">Ask your coach</h2>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label htmlFor="tips-model" className="eyebrow">Model</label>
          <select id="tips-model" autoComplete="off" value={modelId} disabled={streaming || !playable.length}
            onChange={(event) => { setModelId(event.target.value); saveSelectedArena(event.target.value); }}
            className="h-9 min-w-0 max-w-full rounded-control border border-line-strong bg-inset px-2 text-xs text-ink transition-colors duration-(--duration-fast) hover:border-ink-faint focus-ring sm:max-w-56">
            {!playable.length && <option value="">{loadError ? "Unavailable" : "Loading…"}</option>}
            {playable.map((arena) => <option key={arena.id} value={arena.id}>{arena.display_name}</option>)}
          </select>
          {messages.length > 0 && <Button size="sm" onClick={restart}>New chat</Button>}
        </div>
      </div>
      <div ref={transcript} role="region" aria-label="Coaching conversation" tabIndex={0}
        onScroll={event => { const node = event.currentTarget; followReply.current = node.scrollHeight - node.clientHeight - node.scrollTop < 64; }}
        className="min-h-64 max-h-[52svh] space-y-4 overflow-y-auto overscroll-contain rounded-control p-1 focus-ring">
        {messages.length === 0 && <div className="py-10 text-center"><h3 className="text-lg font-semibold">Build a stronger argument</h3><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">Ask how to open, handle a tricky side, or improve a prompt you&apos;re drafting. Choose a quick tip to get started.</p></div>}
        {messages.map((message, index) => (
          <div key={index} className={`animate-rise ${message.role === "user" ? "sm:ml-10 rounded-inset border border-accent/20 bg-accent-wash px-4 py-3" : "sm:mr-10 rounded-inset border border-line bg-inset px-4 py-3"}`}>
            <p className="eyebrow mb-1">{message.role === "user" ? "You" : "Coach"}</p>
            {/* Model output is plain text only (AGENTS.md), never Markdown or HTML. */}
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-relaxed">{message.content || (streaming && index === messages.length - 1 ? "Thinking…" : "")}</p>
          </div>
        ))}
      </div>
      <p role="status" className="mt-3 min-h-4 text-xs text-ink-muted">{streaming ? "Coach is replying…" : error ? "Your question is ready to try again." : messages.length > 0 ? "Reply complete. Ask a follow-up or start a new chat." : "This conversation stays in this page."}</p>
      {error && <p id="tips-error" role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {full ? <p className="text-sm text-ink-muted">This conversation is at its limit. <button type="button" onClick={restart} className={linkClass}>Start a new chat</button></p> :
        <form method="post" onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
          <label htmlFor="tips-input" className="sr-only">Your question</label>
          <textarea ref={input} id="tips-input" name="question" autoComplete="off" aria-invalid={overBudget} aria-describedby={`tips-input-help${error ? " tips-error" : ""}`} rows={2} value={draft} maxLength={MAX_MESSAGE} readOnly={streaming || !modelId}
            onChange={(event) => { setDraft(event.target.value); setError(""); }}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }}
            placeholder="How should I argue the con side of a silly topic?"
            className="min-h-12 min-w-0 flex-1 resize-y rounded-control border border-line-strong bg-inset px-4 py-3 text-sm text-ink placeholder:text-ink-faint transition-colors duration-(--duration-fast) hover:border-ink-faint aria-invalid:border-danger/60 focus-ring" />
          <Button type="submit" variant="primary" aria-disabled={streaming || !draft.trim() || !modelId || overBudget} className="h-auto self-stretch">{streaming ? "Replying…" : "Send"}</Button>
          <div id="tips-input-help" className="flex w-full flex-wrap justify-between gap-2 text-xs text-ink-faint"><span>Enter to send · Shift + Enter for a new line</span><span className={`tabular-nums ${overBudget ? "text-danger" : ""}`}>{draft.length.toLocaleString()} / {remaining.toLocaleString()} characters</span></div>
        </form>}
    </section>
    <aside aria-labelledby="tips-title" className="panel min-w-0 p-panel">
      <h2 id="tips-title" className="mb-4 text-sm font-bold">Quick tips</h2>
      {!loaded && !loadError && <Skeleton label="Loading tips…" variant="lines" count={5} />}
      {loaded && tips.length === 0 && <p className="text-sm leading-relaxed text-ink-muted">No starter tips available. Ask the coach a question to get started.</p>}
      <ul className="space-y-2">
        {tips.map((tip) => <li key={tip}>
          <button type="button" aria-disabled={streaming || !modelId || full} onClick={() => void send(`Tell me more about this tip: ${tip}`)}
            className="w-full rounded-inset border border-line bg-inset/50 px-4 py-3 text-left text-xs leading-relaxed text-ink-muted [overflow-wrap:anywhere] transition-[border-color,color,transform] duration-(--duration-fast) interactive:hover:border-line-strong interactive:hover:text-ink interactive:active:scale-[0.99] aria-disabled:opacity-45 focus-ring">{tip}</button>
        </li>)}
      </ul>
    </aside>
  </div>;
}
