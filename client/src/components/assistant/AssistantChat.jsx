// src/components/assistant/AssistantChat.jsx
// One private chat with the assistant: the message list, the box,
// "Clear chat", and the privacy note. `endpoint` picks the thread:
//   /api/classes/:id/assistant – in that class, with its material
//   /api/me/assistant          – not tied to a class
// The corner panel (AssistantLauncher) shows it for students and professors.
//
// A message that fails (AI busy, a limit) stays in the box with the error
// under it; nothing is saved on the server until the AI has answered.
import React, { useEffect, useRef, useState } from "react";
import AutoGrowTextarea from "../ui/AutoGrowTextarea";
import api from "../../api/axios";
import { useClassView, PREVIEW_MESSAGE } from "../../context/ClassViewContext";
import { useAuth } from "../../context/AuthContext";
import { useRetryCountdown } from "../../hooks/useRetryCountdown";

const MAX_LEN = 1000;

// mode: "course" or "site" (wording only). initial: the endpoint's GET response,
// when the caller already has it. fill: grow to the panel's height instead of
// a fixed-height list.
function AssistantChat({ endpoint, mode = "course", initial = null, fill = false }) {
  const { preview } = useClassView();
  const isProfessor = useAuth().user?.role === "professor";
  const [state, setState] = useState(initial);   // { configured, retention_days, messages, own_key }
  const [draft, setDraft] = useState("");
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState(null);
  const { waitSeconds, waiting, startFromError } = useRetryCountdown(() => setError(null));
  const listRef = useRef(null);

  useEffect(() => {
    if (initial) { setState(initial); return; }
    let ignore = false;
    setState(null);
    api.get(endpoint)
      .then((res) => { if (!ignore) setState(res.data); })
      .catch((err) => console.error("Failed to load the assistant:", err));
    return () => { ignore = true; };
  }, [endpoint, initial]);

  // Keep the newest message in view.
  const count = state?.messages.length ?? 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, busy]);

  async function send() {
    const content = draft.trim();
    if (!content || busy || waiting) return;
    if (preview) { setError(PREVIEW_MESSAGE); return; }
    setBusy(true); setError(null);
    try {
      const { data } = await api.post(`${endpoint}/messages`, { content });
      setState((s) => ({ ...s, messages: [...s.messages, ...data.messages] }));
      setDraft("");
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't reach the study assistant. Please try again.");
      startFromError(err);
    } finally {
      setBusy(false);
    }
  }

  async function clearChat() {
    if (preview) { setError(PREVIEW_MESSAGE); return; }
    if (!window.confirm("Clear your whole chat with the study assistant? This can't be undone.")) return;
    setError(null);
    try {
      await api.delete(`${endpoint}/messages`);
      setState((s) => ({ ...s, messages: [] }));
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't clear the chat.");
    }
  }

  if (!state) {
    return <p className="mt-3 text-xs text-slate-400 animate-pulse">Loading…</p>;
  }
  const { messages, own_key: ownKey } = state;
  const empty = isProfessor
    ? mode === "site"
      ? "Ask me anything, from teaching ideas, writing and coding to how this website works."
      : "Ask me anything, from this course's material and teaching ideas to how this website works."
    : mode === "site"
      ? "Ask me anything, from schoolwork, writing and coding to how this website works."
      : "Ask me anything, from this course's material to any other question you have.";

  return (
    <section aria-label="Study assistant chat" className={fill ? "flex flex-col min-h-0 flex-1" : ""}>
      {!state.configured && (
        <p className="mt-2 text-xs text-orange-500">AI isn't set up on the server yet, so the assistant can't answer.</p>
      )}

      <div
        ref={listRef}
        role="log"
        aria-label="Chat with the study assistant"
        className={`mt-3 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 space-y-3 ${
          fill ? "flex-1 min-h-0" : "max-h-96"
        }`}
      >
        {messages.length === 0 && !busy && (
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center">{empty}</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                m.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
              }`}
            >
              <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
              {m.content}
            </div>
          </div>
        ))}
        {busy && <p className="text-xs italic text-slate-500 dark:text-slate-400">Thinking…</p>}
      </div>

      <div className="mt-3">
        <AutoGrowTextarea
          aria-label="Message the study assistant"
          minRows={2}
          maxHeight={fill ? 120 : 200}
          autoFocus={fill}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }}
          maxLength={MAX_LEN}
          placeholder="Ask the study assistant… (Enter to send, Shift+Enter for a new line)"
          className="w-full std-text text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20 placeholder-slate-400 dark:placeholder-slate-500"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className={`text-xs ${draft.length >= MAX_LEN - 50 ? "text-orange-500" : "text-slate-400"}`}>
            {draft.length} / {MAX_LEN}
          </span>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button type="button" className="white-btn text-xs py-1.5" onClick={clearChat} disabled={busy}>
                Clear chat
              </button>
            )}
            <button
              type="button"
              className="blue-btn text-xs py-1.5"
              onClick={send}
              disabled={!draft.trim() || busy || waiting}
            >
              {busy ? "Thinking…" : waiting ? `Try again in ${waitSeconds}s` : "Send"}
            </button>
          </div>
        </div>
        {error && <p role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
      </div>

      <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
        {ownKey && <>Answering with your Gemini key (••••{ownKey.last4}). </>}
        AI can make mistakes.{" "}
        {isProfessor
          ? "Your chat is private, and never part of the students' summary."
          : mode === "site"
            ? "Ask your professor about anything graded. Your chat is private."
            : "Ask your professor about anything graded. Your chat is private: your professor only sees an anonymous summary of topics."}{" "}
        Messages are deleted after {state.retention_days} days.
      </p>
    </section>
  );
}

export default AssistantChat;
