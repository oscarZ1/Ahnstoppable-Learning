// src/components/classroom/QuestionSummary.jsx
// Professor-only AI summary of the viewed day's student questions. Created on
// demand ("Summarize questions"), saved on the server, and shown again when the
// day is reopened; "Refresh" re-runs it, e.g. after new questions arrive (the
// server skips the AI call when nothing changed). When the AI service says how
// long to wait, the button counts down until then.
import React, { useEffect, useState } from "react";
import api from "../../api/axios";

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

function QuestionSummary({ classId, date, questionCount }) {
  const [data,  setData]  = useState(null);   // { summary, current_question_count, configured }
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [waitUntil, setWaitUntil] = useState(0);  // ms timestamp; 0 = no wait
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second while a wait is running.
  useEffect(() => {
    if (!waitUntil) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= waitUntil) { setWaitUntil(0); setError(null); }
    }, 1000);
    return () => clearInterval(timer);
  }, [waitUntil]);

  useEffect(() => {
    if (!classId || !date) return;
    let ignore = false;
    setData(null); setError(null); setNotice(null);
    api.get(`/api/classes/${classId}/questions/summary`, { params: { date } })
      .then((res) => { if (!ignore) setData(res.data); })
      .catch((err) => { if (!ignore) console.error("Failed to load the question summary:", err); });
    return () => { ignore = true; };
  }, [classId, date]);

  async function summarize() {
    if (busy || waiting) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const { data: fresh } = await api.post(`/api/classes/${classId}/questions/summary`, { date });
      setData(fresh);
      if (fresh.unchanged) setNotice("Nothing has changed since this summary, so it wasn't run again.");
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't summarize the questions.");
      const retryAfter = Number(err.response?.data?.retry_after);
      if (retryAfter > 0) {
        const t = Date.now();
        setNow(t);
        setWaitUntil(t + retryAfter * 1000);
      }
    } finally {
      setBusy(false);
    }
  }

  const waitSeconds = waitUntil ? Math.max(0, Math.ceil((waitUntil - now) / 1000)) : 0;
  const waiting = waitSeconds > 0;

  if (!data) return null;
  const saved      = data.summary;
  const configured = data.configured;

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
          {busy ? "Summarizing…" : waiting ? `Try again in ${waitSeconds}s` : "✨ Summarize questions"}
        </button>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {!configured
            ? "AI summaries aren't set up on the server yet."
            : questionCount === 0
              ? "Nothing to summarize yet."
              : "An AI overview of this day's questions, only visible to you."}
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
      aria-label="AI summary of questions"
      className="mt-3 rounded-lg border border-violet-200 dark:border-violet-500/30 bg-violet-50/60 dark:bg-violet-500/10 p-3 sm:p-4"
    >
      <h3 className="text-sm font-semibold text-violet-800 dark:text-violet-200">✨ AI summary</h3>
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
                    <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{plural(t.question_numbers.length, "question")}</span>
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
      <Bullets title="Ideas for next class" items={s.suggested_followups} />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Summarized at {timeOf(saved.created_at)} from {plural(saved.question_count, "question")} · AI-generated, may contain mistakes
        </p>
        <button
          type="button"
          className={`${newSince > 0 ? "blue-btn" : "white-btn border border-slate-200 dark:border-slate-700"} text-xs py-1.5`}
          onClick={summarize}
          disabled={busy || waiting || !configured}
        >
          {busy ? "Summarizing…"
            : waiting ? `Try again in ${waitSeconds}s`
            : newSince > 0 ? `Refresh (${plural(newSince, "new question")})` : "Refresh"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {notice && !error && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{notice}</p>}
    </section>
  );
}

export default QuestionSummary;
