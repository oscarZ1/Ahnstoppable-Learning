// src/components/classroom/QuestionSummary.jsx
// AI summary of the viewed day's student questions, in the Questions card for
// the professor and the class's students alike. Created on demand ("Summarize
// questions"), saved on the server, and shown again when the day is reopened;
// "Refresh" re-runs it, e.g. after new questions arrive (the server skips the
// AI call when nothing changed). When the AI service says how long to wait, the
// button counts down until then.
//
// Students (forStudents) never see an outdated summary: pass the day's
// question texts (currentQuestions), and if they no longer match what was
// summarized (a question was added, edited or deleted), it offers an update
// instead. The server enforces the same, and leaves out "Ideas for next class".
//
// Also used for the study assistant's summary (StudyAssistantSettings): pass a
// different endpoint, title and wording. questionCount defaults to the count
// the server reports.
import React, { useEffect, useState } from "react";
import api from "../../api/axios";
import { useRetryCountdown } from "../../hooks/useRetryCountdown";
import { useClassView, PREVIEW_MESSAGE } from "../../context/ClassViewContext";

function timeOf(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function Bullets({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h4>
      <ul className="mt-1 list-disc pl-5 space-y-0.5 text-sm text-slate-700 dark:text-slate-200">
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  );
}

function QuestionSummary({
  classId, date, questionCount,
  endpoint = `/api/classes/${classId}/questions/summary`,
  title = "✨ AI summary",
  regionLabel = "AI summary of questions",
  buttonText = "✨ Summarize questions",
  description = "An AI overview of this day's questions, only visible to you.",
  emptyText = "Nothing to summarize yet.",
  noun = "question",
  forStudents = false,
  currentQuestions = null,
}) {
  const { preview } = useClassView();
  const [data,  setData]  = useState(null);   // { summary, current_question_count, configured }
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const { waitSeconds, waiting, startFromError } = useRetryCountdown(() => setError(null));

  useEffect(() => {
    if (!classId || !date) return;
    let ignore = false;
    setData(null); setError(null); setNotice(null);
    api.get(endpoint, { params: { date } })
      .then((res) => { if (!ignore) setData(res.data); })
      .catch((err) => { if (!ignore) console.error("Failed to load the summary:", err); });
    return () => { ignore = true; };
  }, [classId, date, endpoint]);

  async function summarize() {
    if (busy || waiting) return;
    if (preview) { setError(PREVIEW_MESSAGE); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const { data: fresh } = await api.post(endpoint, { date });
      setData(fresh);
      if (fresh.unchanged) setNotice("Nothing has changed since this summary, so it wasn't run again.");
    } catch (err) {
      setError(err.response?.data?.error ?? `Couldn't summarize the ${noun}s.`);
      startFromError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  questionCount ??= data.current_question_count ?? 0;
  const configured = data.configured;
  const covered    = data.summary?.summary?.questions;
  // Outdated when the server says so on loading, or (live) when the day's
  // questions no longer match what was summarized.
  const outdated   = forStudents && (data.outdated || (Boolean(data.summary) && Array.isArray(currentQuestions)
    && !(Array.isArray(covered) && covered.length === currentQuestions.length
         && covered.every((q, i) => q.content === currentQuestions[i]))));
  const saved      = outdated ? null : data.summary;

  // ── No summary yet ────────────────────────────────────────────────────────
  if (!saved) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="white-btn text-xs py-1.5 border border-slate-200 dark:border-slate-700"
          onClick={summarize}
          disabled={busy || waiting || questionCount === 0 || !configured}
        >
          {busy ? "Summarizing…" : waiting ? `Try again in ${waitSeconds}s` : buttonText}
        </button>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {!configured
            ? "AI summaries aren't set up on the server yet."
            : questionCount === 0
              ? emptyText
              : outdated
                ? "The questions changed since the last summary. Summarize again to update it."
                : description}
        </span>
        {error && <p className="w-full text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  // ── Saved summary ─────────────────────────────────────────────────────────
  const s         = saved.summary;
  const byNumber  = Object.fromEntries((s.questions ?? []).map((q) => [q.number, q]));
  const newSince  = Math.max(0, questionCount - saved.question_count);

  return (
    <section
      aria-label={regionLabel}
      className="mt-3 rounded-lg border border-violet-200 dark:border-violet-500/30 bg-violet-50/60 dark:bg-violet-500/10 p-3 sm:p-4"
    >
      <h3 className="text-sm font-semibold text-violet-800 dark:text-violet-200">{title}</h3>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{s.overview}</p>

      {s.themes?.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Themes</h4>
          <ul className="mt-1 space-y-2">
            {s.themes.map((t, i) => (
              <li key={i} className="text-sm">
                <details>
                  <summary className="cursor-pointer text-slate-500 dark:text-slate-400">
                    <span className="font-semibold std-text">{t.title}</span>
                    <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{plural(t.question_numbers.length, noun)}</span>
                  </summary>
                  <p className="mt-1 text-slate-600 dark:text-slate-300">{t.description}</p>
                  <ul className="mt-1 pl-4 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {t.question_numbers.map((n) => byNumber[n] && (
                      <li key={n}>“{byNumber[n].content}”{byNumber[n].answered ? " · answered" : ""}</li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Bullets title="Common confusions" items={s.confusions} />
      {!forStudents && <Bullets title="Ideas for next class" items={s.suggested_followups} />}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Summarized at {timeOf(saved.created_at)} from {plural(saved.question_count, noun)} · AI-generated, may contain mistakes
        </p>
        <button
          type="button"
          className={`${newSince > 0 ? "blue-btn" : "white-btn border border-slate-200 dark:border-slate-700"} text-xs py-1.5`}
          onClick={summarize}
          disabled={busy || waiting || !configured}
        >
          {busy ? "Summarizing…"
            : waiting ? `Try again in ${waitSeconds}s`
            : newSince > 0 ? `Refresh (${plural(newSince, `new ${noun}`)})` : "Refresh"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {notice && !error && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{notice}</p>}
    </section>
  );
}

export default QuestionSummary;
