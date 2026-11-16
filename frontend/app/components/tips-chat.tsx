"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { backendUrl } from "../lib/auth";
import { parseArenas, type Arena } from "../lib/protocol";
import { preferredArena, saveSelectedArena } from "../lib/selected-arena";
import Button, { linkClass } from "./button";
import Skeleton from "./skeleton";
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = new AbortController();
    async function fetchAll() {
      try {
        const [list, tipData] = await Promise.all([api("/v1/arenas", load.signal), api("/v1/tips", load.signal)]);
        const parsed = parseArenas(list);
        setArenas(parsed);
        setModelId(preferredArena(parsed));
        const tipList = (tipData as { tips?: unknown })?.tips;
        setTips(Array.isArray(tipList) ? tipList.filter((tip): tip is string => typeof tip === "string") : []);
        setLoaded(true);
      } catch (err) {
        if (load.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) { router.replace("/login"); return; }
        setLoadError("Couldn’t load models. Refresh to try again.");
      }
    }
    void fetchAll();
    return () => { load.abort(); controller.current?.abort(); };
  }, [router]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages]);

  const used = messages.reduce((sum, message) => sum + message.content.length, 0);
  const full = used + Math.max(draft.length, 1) > MAX_CONVERSATION || messages.length + 1 > MAX_MESSAGES;

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming || !modelId) return;
    const conversation: Message[] = [...messages, { role: "user", content }];
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
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
  }

  const playable = arenas.filter((arena) => arena.kind === "provided");

  return <div className="grid gap-stack lg:grid-cols-[minmax(0,1fr)_300px]">
    <section aria-labelledby="chat-title" className="panel flex min-h-[520px] flex-col p-panel">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 id="chat-title" className="text-sm font-bold">Ask your coach</h2>
        <div className="flex items-center gap-2">
          <label htmlFor="tips-model" className="eyebrow">Model</label>
          <select id="tips-model" autoComplete="off" value={modelId} disabled={streaming || !playable.length}
            onChange={(event) => { setModelId(event.target.value); saveSelectedArena(event.target.value); }}
            className="h-9 max-w-56 rounded-control border border-line-strong bg-inset px-2 text-xs text-ink transition-colors duration-(--duration-fast) hover:border-ink-faint focus-ring">
            {!playable.length && <option value="">{loadError ? "Unavailable" : "Loading…"}</option>}
            {playable.map((arena) => <option key={arena.id} value={arena.id}>{arena.display_name}</option>)}
          </select>
          {messages.length > 0 && <Button size="sm" onClick={restart}>New chat</Button>}
        </div>
      </div>
      <div aria-live="polite" className="flex-1 space-y-4 overflow-y-auto">
        {messages.length === 0 && <p className="well p-5 text-sm leading-relaxed text-ink-muted">Ask for help with your strategy: how to open, how to handle a tricky side, or feedback on a prompt you&apos;re drafting. Or start from a tip on the right.</p>}
        {messages.map((message, index) => (
          <div key={index} className={`animate-rise ${message.role === "user" ? "ml-10 rounded-inset border border-accent/20 bg-accent-wash px-4 py-3" : "mr-10 rounded-inset border border-line bg-inset px-4 py-3"}`}>
            <p className="eyebrow mb-1">{message.role === "user" ? "You" : "Coach"}</p>
            {/* Model output is plain text only (AGENTS.md), never Markdown or HTML. */}
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content || (streaming && index === messages.length - 1 ? "Thinking…" : "")}</p>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <p role="alert" className="mt-3 min-h-4 text-xs text-danger">{loadError || error}</p>
      {full ? <p className="text-sm text-ink-muted">This conversation is at its limit. <button type="button" onClick={restart} className={linkClass}>Start a new chat</button></p> :
        <form onSubmit={submit} className="mt-1 flex gap-2">
          <label htmlFor="tips-input" className="sr-only">Your question</label>
          <textarea id="tips-input" rows={2} value={draft} maxLength={MAX_MESSAGE} disabled={streaming || !modelId}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }}
            placeholder="How should I argue the con side of a silly topic?"
            className="min-h-12 flex-1 resize-none rounded-control border border-line-strong bg-inset px-4 py-3 text-sm text-ink placeholder:text-ink-faint transition-colors duration-(--duration-fast) hover:border-ink-faint focus-ring" />
          <Button type="submit" variant="primary" disabled={streaming || !draft.trim() || !modelId} className="h-auto self-stretch">{streaming ? "…" : "Send"}</Button>
        </form>}
    </section>
    <aside aria-labelledby="tips-title" className="panel p-panel">
      <h2 id="tips-title" className="mb-4 text-sm font-bold">Quick tips</h2>
      {!loaded && !loadError && <Skeleton label="Loading tips…" variant="lines" count={5} />}
      <ul className="space-y-2">
        {tips.map((tip) => <li key={tip}>
          <button disabled={streaming || !modelId || full} onClick={() => void send(`Tell me more about this tip: ${tip}`)}
            className="w-full rounded-inset border border-line bg-inset/50 px-4 py-3 text-left text-xs leading-relaxed text-ink-muted transition-[border-color,color,transform] duration-(--duration-fast) interactive:hover:border-line-strong interactive:hover:text-ink interactive:active:scale-[0.99] disabled:opacity-45 focus-ring">{tip}</button>
        </li>)}
      </ul>
    </aside>
  </div>;
}
