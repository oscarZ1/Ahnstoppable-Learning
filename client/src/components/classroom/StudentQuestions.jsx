// src/components/classroom/StudentQuestions.jsx
// Standing question box. Students can ask at any time; classmates see the
// question anonymously, the professor sees the name and can write an answer.
// Shows the questions asked on the viewed day and updates live.
import React, { useEffect, useRef, useState } from "react";
import SectionHeading from "../ui/SectionHeading";
import api from "../../api/axios";
import socket from "../../api/socket";
import { useClassView, PREVIEW_MESSAGE } from "../../context/ClassViewContext";
import { todayKey } from "../../utils/dates";

const MAX_LEN = 300;

function timeOf(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function AnswerBox({ onSubmit }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await onSubmit(text.trim()); setText(""); setOpen(false); }
    finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
        Answer
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-2">
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        autoFocus
        placeholder="Write an answer the whole class will see"
        className="w-full std-text text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20 resize-none"
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="white-btn text-xs py-1.5" onClick={() => { setOpen(false); setText(""); }} disabled={busy}>Cancel</button>
        <button type="button" className="blue-btn text-xs py-1.5" onClick={submit} disabled={!text.trim() || busy}>{busy ? "Saving…" : "Post answer"}</button>
      </div>
    </div>
  );
}

function StudentQuestions({ classId, date, showNames }) {
  const { isProfessor, preview } = useClassView();
  const today = todayKey();

  const [questions, setQuestions] = useState([]);
  const [draft, setDraft]         = useState("");
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState(null);
  const mine = useRef(new Set());   // ids of questions this student asked (server never echoes our name)

  // Load the viewed day's questions
  useEffect(() => {
    if (!classId || !date) return;
    let ignore = false;
    api.get(`/api/classes/${classId}/questions`, { params: { date } })
      .then((res) => { if (!ignore) setQuestions(res.data); })
      .catch((err) => console.error("Failed to load questions:", err));
    return () => { ignore = true; };
  }, [classId, date]);

  // Live updates
  useEffect(() => {
    const onNew = (q) => {
      if (q.asked_date !== date) return;
      setQuestions((prev) => (prev.some((x) => x.id === q.id) ? prev : [...prev, q]));
    };
    const onAnswered = ({ id, answer, answered_at }) => {
      setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, answer, answered_at } : q)));
    };
    socket.on("question:new", onNew);
    socket.on("question:answered", onAnswered);
    return () => {
      socket.off("question:new", onNew);
      socket.off("question:answered", onAnswered);
    };
  }, [date]);

  async function ask() {
    const content = draft.trim();
    if (!content || busy) return;
    if (preview) { setError(PREVIEW_MESSAGE); return; }
    setBusy(true); setError(null);
    try {
      const { data } = await api.post(`/api/classes/${classId}/questions`, { content, asked_date: today });
      mine.current.add(data.id);
      setDraft("");
      // The socket echo adds it to the list; if we're viewing another day, jump the user's eye to today.
      if (date === today) setQuestions((prev) => (prev.some((x) => x.id === data.id) ? prev : [...prev, data]));
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't send your question.");
    } finally {
      setBusy(false);
    }
  }

  async function answer(id, text) {
    setError(null);
    try {
      await api.patch(`/api/classes/${classId}/questions/${id}/answer`, { answer: text });
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't save the answer.");
      throw err;
    }
  }

  function nameFor(q) {
    if (mine.current.has(q.id)) return "You";
    return (showNames || q.author_role === "professor") && q.author_name ? q.author_name : "Anonymous";
  }

  const unanswered = questions.filter((q) => !q.answer).length;

  return (
    <div className="w-full rounded-lg shadow-md p-4 sm:p-6 border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading text="Questions ❓" />
        {questions.length > 0 && (
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
            {questions.length} asked · {unanswered} waiting
          </span>
        )}
      </div>

      {/* Ask box (students) */}
      {!isProfessor && (
        <div className="mt-3">
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(); }}
            maxLength={MAX_LEN}
            placeholder="Stuck on something? Ask here any time. Classmates see it anonymously."
            className="w-full std-text text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20 resize-none placeholder-slate-400 dark:placeholder-slate-500 font-medium"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className={`text-xs ${draft.length >= MAX_LEN - 20 ? "text-orange-500" : "text-slate-400"}`}>
              {draft.length} / {MAX_LEN}
            </span>
            <button type="button" className="blue-btn text-xs py-1.5" onClick={ask} disabled={!draft.trim() || busy}>
              {busy ? "Sending…" : "Ask"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {/* List */}
      {questions.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500 text-center">
          {isProfessor ? "No questions yet on this day." : "No questions yet. Be the first."}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">
          {questions.map((q) => (
            <li key={q.id} className="py-3">
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold std-text">{nameFor(q)}</span>
                <span>• {timeOf(q.created_at)}</span>
                {!q.answer && isProfessor && <span className="ml-auto"><AnswerBox onSubmit={(t) => answer(q.id, t)} /></span>}
              </div>
              <p className="mt-1 text-[15px] leading-relaxed text-slate-800 dark:text-slate-200">{q.content}</p>
              {q.answer && (
                <div className="mt-2 ml-3 pl-3 border-l-2 border-blue-400 dark:border-blue-500">
                  <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                    Professor answered · {timeOf(q.answered_at)}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{q.answer}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default StudentQuestions;
