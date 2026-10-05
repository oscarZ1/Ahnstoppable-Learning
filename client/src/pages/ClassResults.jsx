// src/pages/ClassResults.jsx
// Professor-only record of every poll and understanding check in a class,
// across all dates: counts, who answered what, and a CSV download of each
// student's answers (e.g. for participation grades).
import React, { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";
import SectionHeading from "../components/ui/SectionHeading";

const card = "w-full rounded-lg shadow-md p-4 sm:p-6 border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700";
const th   = "py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 whitespace-nowrap";
const td   = "py-2 pr-3 align-top text-sm text-slate-700 dark:text-slate-200";

const RESPONSES = {
  thumbs_up:   { emoji: "👍", label: "Got it" },
  hand:        { emoji: "👋", label: "Question" },
  thumbs_down: { emoji: "👎", label: "Lost" },
};

function dateOf(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function timeOf(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function pct(n, of) {
  return of > 0 ? Math.round((n / of) * 100) : 0;
}

// ── CSV ───────────────────────────────────────────────────────────────────────
function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function fileSafe(text) {
  return String(text).trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function ExpandButton({ open, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={label}
      className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer whitespace-nowrap"
    >
      {open ? "▾ Hide" : "▸ Who answered"}
    </button>
  );
}

// ── Polls ─────────────────────────────────────────────────────────────────────
function PollsTable({ polls, classSlug }) {
  const [openId, setOpenId] = useState(null);

  function exportCsv() {
    const rows = [];
    for (const { poll, tally } of polls) {
      const byId = Object.fromEntries((tally ?? []).map((t) => [t.option_id, t]));
      for (const o of poll.options) {
        for (const v of byId[o.id]?.voters ?? []) {
          rows.push([dateOf(poll.created_at), timeOf(poll.created_at), poll.question, v.name, o.text]);
        }
      }
    }
    downloadCsv(`${classSlug}-polls.csv`, ["Date", "Time", "Question", "Student", "Answer"], rows);
  }

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading text="Polls 📊" />
        <button type="button" className="white-btn text-xs py-1.5" onClick={exportCsv} disabled={polls.length === 0}>
          Download CSV
        </button>
      </div>

      {polls.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">No polls yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full" aria-label="Polls">
            <thead>
              <tr><th className={th}>Date</th><th className={th}>Question</th><th className={th}>Results</th><th className={th}>Responded</th><th className={th}><span className="sr-only">Details</span></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {polls.map(({ poll, tally, responded, total_students }) => {
                const byId = Object.fromEntries((tally ?? []).map((t) => [t.option_id, t]));
                const open = openId === poll.id;
                return (
                  <React.Fragment key={poll.id}>
                    <tr>
                      <td className={`${td} whitespace-nowrap`}>{dateOf(poll.created_at)}<div className="text-xs text-slate-400">{timeOf(poll.created_at)}{poll.closed_at ? "" : " · open"}</div></td>
                      <td className={`${td} font-semibold std-text`}>{poll.question}</td>
                      <td className={td}>
                        {poll.options.map((o) => {
                          const n = byId[o.id]?.count ?? 0;
                          return <div key={o.id} className="whitespace-nowrap">{o.text}: <span className="font-semibold tabular-nums">{n}</span> <span className="text-xs text-slate-400">({pct(n, responded)}%)</span></div>;
                        })}
                      </td>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>{responded} of {total_students}</td>
                      <td className={td}><ExpandButton open={open} onClick={() => setOpenId(open ? null : poll.id)} label={`Who answered: ${poll.question}`} /></td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={5} className="pb-3">
                          <div className="rounded-md bg-slate-50 dark:bg-slate-900/40 p-3 grid gap-2 sm:grid-cols-2">
                            {poll.options.map((o) => {
                              const voters = byId[o.id]?.voters ?? [];
                              return (
                                <div key={o.id}>
                                  <p className="text-xs font-semibold std-text">{o.text} ({voters.length})</p>
                                  <p className="text-xs text-slate-500 dark:text-slate-400">{voters.length ? voters.map((v) => v.name).join(", ") : "Nobody"}</p>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Understanding checks ─────────────────────────────────────────────────────
function ChecksTable({ rounds, totalStudents, classSlug }) {
  const [openId, setOpenId] = useState(null);

  function exportCsv() {
    const rows = [];
    for (const r of rounds) {
      for (const a of r.responses) {
        rows.push([dateOf(r.started_at), timeOf(r.started_at), r.label || "Untitled check", a.name, RESPONSES[a.response]?.label ?? a.response]);
      }
    }
    downloadCsv(`${classSlug}-understanding-checks.csv`, ["Date", "Time", "Check", "Student", "Response"], rows);
  }

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading text="Understanding Checks 🤔" />
        <button type="button" className="white-btn text-xs py-1.5" onClick={exportCsv} disabled={rounds.length === 0}>
          Download CSV
        </button>
      </div>

      {rounds.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">No understanding checks yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full" aria-label="Understanding checks">
            <thead>
              <tr>
                <th className={th}>Date</th><th className={th}>Check</th>
                <th className={th} title="Got it">👍</th><th className={th} title="Question">👋</th><th className={th} title="Lost">👎</th>
                <th className={th}>Responded</th><th className={th}><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {rounds.map((r) => {
                const open = openId === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td className={`${td} whitespace-nowrap`}>{dateOf(r.started_at)}<div className="text-xs text-slate-400">{timeOf(r.started_at)}{r.ended_at ? "" : " · running"}</div></td>
                      <td className={`${td} font-semibold std-text`}>{r.label || "Untitled check"}</td>
                      <td className={`${td} tabular-nums`}>{r.thumbs_up}</td>
                      <td className={`${td} tabular-nums`}>{r.hand}</td>
                      <td className={`${td} tabular-nums`}>{r.thumbs_down}</td>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>{r.responded} of {totalStudents}</td>
                      <td className={td}><ExpandButton open={open} onClick={() => setOpenId(open ? null : r.id)} label={`Who answered: ${r.label || "Untitled check"}`} /></td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} className="pb-3">
                          <div className="rounded-md bg-slate-50 dark:bg-slate-900/40 p-3">
                            {r.responses.length === 0 ? (
                              <p className="text-xs text-slate-500 dark:text-slate-400">Nobody answered.</p>
                            ) : (
                              <ul className="grid gap-1 sm:grid-cols-2">
                                {r.responses.map((a) => (
                                  <li key={a.user_id} className="text-xs text-slate-600 dark:text-slate-300">
                                    {RESPONSES[a.response]?.emoji} {a.name} <span className="text-slate-400">· {RESPONSES[a.response]?.label}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ClassResults() {
  const { classId } = useParams();
  const { user }    = useAuth();
  const isProfessor = user?.role === "professor";

  const [cls,    setCls]    = useState(null);
  const [polls,  setPolls]  = useState(null);
  const [checks, setChecks] = useState(null);
  const [error,  setError]  = useState(null);

  useEffect(() => {
    if (!isProfessor) return;
    let ignore = false;
    Promise.all([
      api.get(`/api/classes/${classId}`),
      api.get(`/api/classes/${classId}/polls/history`),
      api.get(`/api/classes/${classId}/understand/history`),
    ])
      .then(([c, p, u]) => { if (!ignore) { setCls(c.data); setPolls(p.data); setChecks(u.data); } })
      .catch((err) => { if (!ignore) setError(err.response?.data?.error ?? "Couldn't load results."); });
    return () => { ignore = true; };
  }, [classId, isProfessor]);

  if (!isProfessor) return <Navigate to={`/class/${classId}`} replace />;

  const classLabel = cls ? (cls.section ? `${cls.title} · ${cls.section}` : cls.title) : "";
  const classSlug  = fileSafe(cls ? `${cls.title}-${cls.section ?? ""}` : `class-${classId}`);

  return (
    <div className="flex-1 background transition-colors duration-300">
      <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="std-text text-2xl sm:text-3xl">Results{classLabel && ` · ${classLabel}`}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Every poll and understanding check in this class, newest first.</p>
          </div>
          <Link to={`/class/${classId}`} className="white-btn text-sm">← Back to class</Link>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {!error && (!polls || !checks) && <p className="text-sm text-slate-400">Loading…</p>}

        {polls  && <PollsTable polls={polls} classSlug={classSlug} />}
        {checks && <ChecksTable rounds={checks.rounds} totalStudents={checks.total_students} classSlug={classSlug} />}
      </div>
    </div>
  );
}

export default ClassResults;
