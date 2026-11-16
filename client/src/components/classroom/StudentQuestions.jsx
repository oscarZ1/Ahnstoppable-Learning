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
import QuestionSummary from "./QuestionSummary";
import ItemText from "./ItemText";
import AutoGrowTextarea from "../ui/AutoGrowTextarea";

const MAX_LEN = 300;

function timeOf(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const MAX_REPLY_LEN = 1000;

// Reply under an answered question. Stays open with its text if posting fails.
function QuestionReplyBox({ onSubmit, onCancel }) {
  const [text, setText]   = useState("");
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await onSubmit(text.trim());
      setText("");
      onCancel();
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? "Couldn't post your reply.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <AutoGrowTextarea
        aria-label="Write a reply to this answer"
        minRows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
        maxLength={MAX_REPLY_LEN}
        autoFocus
        placeholder="Reply to the answer…"
        className="w-full std-text text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="white-btn text-xs py-1.5" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="blue-btn text-xs py-1.5" onClick={submit} disabled={!text.trim() || busy}>
          {busy ? "Posting…" : "Post reply"}
        </button>
      </div>
    </div>
  );
}

// The professor's answer box: full width under the question, growing with the text.
function AnswerBox({ onSubmit, onCancel }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await onSubmit(text.trim()); setText(""); onCancel(); }
    catch { /* the error is shown on the card; keep the text */ }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <AutoGrowTextarea
        aria-label="Write an answer"
        minRows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
        maxLength={1000}
        autoFocus
        placeholder="Write an answer the whole class will see"
        className="w-full std-text text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20"
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="white-btn text-xs py-1.5" onClick={onCancel} disabled={busy}>Cancel</button>
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
  const mine = useRef(new Set());          // questions this user asked this session (live copies lack is_mine)
  const mineReplies = useRef(new Set());   // replies this user wrote this session
  const [replyOpenFor, setReplyOpenFor] = useState(null);   // question id whose reply box is open
  const [answeringFor, setAnsweringFor] = useState(null);   // question id the professor is answering

  // Load the viewed day's questions
  useEffect(() => {
    if (!classId || !date) return;
    let ignore = false;
    api.get(`/api/classes/${classId}/questions`, { params: { date } })
      .then((res) => { if (!ignore) setQuestions(res.data); })
      .catch((err) => console.error("Failed to load questions:", err));
    return () => { ignore = true; };
  }, [classId, date]);

  // ── State helpers ────────────────────────────────────────────────────────
  function patchQuestion(id, fn) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? fn(q) : q)));
  }
  function patchReply(questionId, replyId, fn) {
    patchQuestion(questionId, (q) => ({ ...q, replies: (q.replies ?? []).map((r) => (r.id === replyId ? fn(r) : r)) }));
  }
  // Add a reply to a question once (the live update and the POST response can both arrive).
  function addReply(q, r) {
    const replies = q.replies ?? [];
    return replies.some((x) => x.id === r.id) ? q : { ...q, replies: [...replies, r] };
  }

  // Live updates
  useEffect(() => {
    const on = {
      "question:new": (q) => {
        if (q.asked_date !== date) return;
        setQuestions((prev) => (prev.some((x) => x.id === q.id) ? prev : [...prev, q]));
      },
      "question:answered": ({ id, answer, answered_at, answer_edited_at }) =>
        patchQuestion(id, (q) => ({ ...q, answer, answered_at, answer_edited_at })),
      "question:updated": ({ id, content, edited_at }) => patchQuestion(id, (q) => ({ ...q, content, edited_at })),
      "question:deleted": ({ id }) => setQuestions((prev) => prev.filter((q) => q.id !== id)),
      "question:answer_deleted": ({ id }) => patchQuestion(id, (q) => ({
        ...q, answer: null, answered_at: null, answer_edited_at: null, answer_like_count: 0, answer_liked_by_me: false, replies: [],
      })),
      "question:likes": ({ id, target, like_count }) => patchQuestion(id, (q) => (
        target === "answer" ? { ...q, answer_like_count: like_count } : { ...q, like_count }
      )),
      "question:reply": (r) => {
        if (r.asked_date !== date) return;
        patchQuestion(r.question_id, (q) => addReply(q, r));
      },
      "question_reply:updated": ({ id, question_id, content, edited_at }) =>
        patchReply(question_id, id, (r) => ({ ...r, content, edited_at })),
      "question_reply:deleted": ({ id, question_id }) =>
        patchQuestion(question_id, (q) => ({ ...q, replies: (q.replies ?? []).filter((r) => r.id !== id) })),
      "question_reply:likes": ({ id, question_id, like_count }) => patchReply(question_id, id, (r) => ({ ...r, like_count })),
    };
    for (const [event, fn] of Object.entries(on)) socket.on(event, fn);
    return () => { for (const [event, fn] of Object.entries(on)) socket.off(event, fn); };
  }, [date]);

  // ── Actions ──────────────────────────────────────────────────────────────
  function blockedByPreview() {
    if (preview) { setError(PREVIEW_MESSAGE); return true; }
    setError(null);
    return false;
  }
  async function attempt(fn, message) {
    try { await fn(); return true; }
    catch (err) { setError(err.response?.data?.error ?? message); return false; }
  }

  async function ask() {
    const content = draft.trim();
    if (!content || busy) return;
    if (blockedByPreview()) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/api/classes/${classId}/questions`, { content, asked_date: today });
      mine.current.add(data.id);
      setDraft("");
      if (date === today) {
        setQuestions((prev) => (prev.some((x) => x.id === data.id)
          ? prev.map((x) => (x.id === data.id ? { ...x, ...data } : x))
          : [...prev, data]));
      }
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't send your question.");
    } finally {
      setBusy(false);
    }
  }

  async function answer(id, text) {
    setError(null);
    try {
      const { data } = await api.patch(`/api/classes/${classId}/questions/${id}/answer`, { answer: text });
      patchQuestion(id, (q) => ({ ...q, ...data }));
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't save the answer.");
      throw err;
    }
  }

  async function postReply(questionId, text) {
    if (preview) throw new Error(PREVIEW_MESSAGE);
    const { data } = await api.post(`/api/classes/${classId}/questions/${questionId}/replies`, { content: text });
    mineReplies.current.add(data.id);
    patchQuestion(questionId, (q) => addReply(q, data));
  }

  const base = `/api/classes/${classId}/questions`;

  const editQuestion = (q, content) => !blockedByPreview() && attempt(async () => {
    const { data } = await api.patch(`${base}/${q.id}`, { content });
    patchQuestion(q.id, (x) => ({ ...x, content: data.content, edited_at: data.edited_at }));
  }, "Couldn't save your edit.");
  const deleteQuestion = (q) => !blockedByPreview() && attempt(async () => {
    await api.delete(`${base}/${q.id}`);
    setQuestions((prev) => prev.filter((x) => x.id !== q.id));
  }, "Couldn't delete the question.");
  const editAnswer = (q, text) => !blockedByPreview() && attempt(() => answer(q.id, text), "Couldn't save the answer.");
  const deleteAnswer = (q) => !blockedByPreview() && attempt(async () => {
    await api.delete(`${base}/${q.id}/answer`);
    patchQuestion(q.id, (x) => ({ ...x, answer: null, answered_at: null, answer_edited_at: null, replies: [] }));
  }, "Couldn't remove the answer.");
  const editReply = (q, r, content) => !blockedByPreview() && attempt(async () => {
    const { data } = await api.patch(`${base}/${q.id}/replies/${r.id}`, { content });
    patchReply(q.id, r.id, (x) => ({ ...x, content: data.content, edited_at: data.edited_at }));
  }, "Couldn't save your edit.");
  const deleteReply = (q, r) => !blockedByPreview() && attempt(async () => {
    await api.delete(`${base}/${q.id}/replies/${r.id}`);
    patchQuestion(q.id, (x) => ({ ...x, replies: (x.replies ?? []).filter((y) => y.id !== r.id) }));
  }, "Couldn't delete the reply.");

  // Thumbs up: flip right away, confirm with the server, undo on failure.
  async function toggleLike({ url, was, count, apply }) {
    if (blockedByPreview()) return;
    apply(!was, count + (was ? -1 : 1));
    try {
      const { data } = was ? await api.delete(url) : await api.put(url);
      apply(data.liked_by_me, data.like_count);
    } catch (err) {
      apply(was, count);
      setError(err.response?.data?.error ?? "Couldn't save your thumbs up.");
    }
  }
  const likeQuestion = (q) => toggleLike({
    url: `${base}/${q.id}/like`, was: !!q.liked_by_me, count: q.like_count ?? 0,
    apply: (liked, n) => patchQuestion(q.id, (x) => ({ ...x, liked_by_me: liked, like_count: n })),
  });
  const likeAnswer = (q) => toggleLike({
    url: `${base}/${q.id}/answer/like`, was: !!q.answer_liked_by_me, count: q.answer_like_count ?? 0,
    apply: (liked, n) => patchQuestion(q.id, (x) => ({ ...x, answer_liked_by_me: liked, answer_like_count: n })),
  });
  const likeReply = (q, r) => toggleLike({
    url: `${base}/${q.id}/replies/${r.id}/like`, was: !!r.liked_by_me, count: r.like_count ?? 0,
    apply: (liked, n) => patchReply(q.id, r.id, (x) => ({ ...x, liked_by_me: liked, like_count: n })),
  });

  // ── Who wrote what ───────────────────────────────────────────────────────
  const isMyQuestion = (q) => !!q.is_mine || mine.current.has(q.id);
  const isMyReply    = (r) => !!r.is_mine || mineReplies.current.has(r.id);
  function nameFor(q) {
    if (isMyQuestion(q)) return "You";
    return (showNames || q.author_role === "professor") && q.author_name ? q.author_name : "Anonymous";
  }
  function replyNameFor(r) {
    if (isMyReply(r)) return "You";
    return (showNames || r.author_role === "professor") && r.author_name ? r.author_name : "Anonymous";
  }
  const editedTag = (when) => when && <span className="ml-1 italic text-slate-400">(edited)</span>;

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

      {/* AI summary of the day's questions (the professor's includes ideas for next class) */}
      {isProfessor ? (
        <QuestionSummary classId={classId} date={date} questionCount={questions.length} />
      ) : (
        <QuestionSummary
          classId={classId}
          date={date}
          questionCount={questions.length}
          currentQuestions={questions.map((q) => q.content)}
          forStudents
          description="An AI overview of this day's questions: the main themes and common confusions. No names."
        />
      )}

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
                <span>• {timeOf(q.created_at)}{editedTag(q.edited_at)}</span>
              </div>

              {/* The question, with thumbs up / Answer / Edit / Delete */}
              <ItemText
                text={q.content}
                label="question"
                maxLength={MAX_LEN}
                textClassName="mt-1 text-[15px] leading-relaxed text-slate-800 dark:text-slate-200"
                likeCount={q.like_count ?? 0}
                liked={!!q.liked_by_me}
                onToggleLike={() => likeQuestion(q)}
                canEdit={isMyQuestion(q)}
                canDelete={isMyQuestion(q) || isProfessor}
                onEdit={(t) => editQuestion(q, t)}
                onDelete={() => deleteQuestion(q)}
                deleteMessage="Delete this question? Its answer and replies will be deleted too."
              >
                {!q.answer && isProfessor && answeringFor !== q.id && (
                  <button
                    type="button"
                    onClick={() => setAnsweringFor(q.id)}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    Answer
                  </button>
                )}
              </ItemText>

              {!q.answer && isProfessor && answeringFor === q.id && (
                <AnswerBox onSubmit={(t) => answer(q.id, t)} onCancel={() => setAnsweringFor(null)} />
              )}

              {q.answer && (
                <div className="mt-2 ml-3 pl-3 border-l-2 border-blue-400 dark:border-blue-500">
                  <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                    Professor answered · {timeOf(q.answered_at)}{editedTag(q.answer_edited_at)}
                  </p>
                  <ItemText
                    text={q.answer}
                    label="answer"
                    textClassName="mt-0.5 text-sm text-slate-700 dark:text-slate-300"
                    likeCount={q.answer_like_count ?? 0}
                    liked={!!q.answer_liked_by_me}
                    onToggleLike={() => likeAnswer(q)}
                    canEdit={isProfessor}
                    canDelete={isProfessor}
                    onEdit={(t) => editAnswer(q, t)}
                    onDelete={() => deleteAnswer(q)}
                    deleteMessage="Remove this answer? Replies to it will be deleted too."
                  >
                    {replyOpenFor !== q.id && (
                      <button
                        type="button"
                        onClick={() => setReplyOpenFor(q.id)}
                        className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                      >
                        Reply
                      </button>
                    )}
                  </ItemText>

                  {/* Follow-up replies to the answer */}
                  {(q.replies ?? []).length > 0 && (
                    <ul className="mt-2 space-y-2" aria-label="Replies to this answer">
                      {q.replies.map((r) => (
                        <li key={r.id} className="text-sm">
                          <span className="text-xs font-semibold std-text">{replyNameFor(r)}</span>
                          <span className="ml-1 text-xs text-slate-400">• {timeOf(r.created_at)}{editedTag(r.edited_at)}</span>
                          <ItemText
                            text={r.content}
                            label="reply"
                            textClassName="text-slate-700 dark:text-slate-300"
                            likeCount={r.like_count ?? 0}
                            liked={!!r.liked_by_me}
                            onToggleLike={() => likeReply(q, r)}
                            canEdit={isMyReply(r)}
                            canDelete={isMyReply(r) || isProfessor}
                            onEdit={(t) => editReply(q, r, t)}
                            onDelete={() => deleteReply(q, r)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  {replyOpenFor === q.id && (
                    <QuestionReplyBox onSubmit={(t) => postReply(q.id, t)} onCancel={() => setReplyOpenFor(null)} />
                  )}
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
