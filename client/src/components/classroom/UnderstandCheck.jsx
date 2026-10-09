// src/components/classroom/UnderstandCheck.jsx
// Professor-run understanding checks. The professor starts a round (optionally
// labelled), students pick 👎 / 👋 / 👍 and may change their pick until the
// professor ends the round. Professors see live counts; students see the
// result once the round has ended.
//
// The panel is day-specific: on today it shows the live round plus today's
// list; past days show that day's rounds as result cards. Professors can also
// open future days and prepare checks there; a prepared check stays invisible
// to students until the professor clicks Start on its day.
import React, { useCallback, useEffect, useState } from "react";
import SectionHeading from "../ui/SectionHeading";
import api from "../../api/axios";
import socket from "../../api/socket";
import { useClassView, PREVIEW_MESSAGE } from "../../context/ClassViewContext";
import { todayKey } from "../../utils/dates";

const RESPONSES = [
  { key: "thumbs_down", emoji: "👎", label: "Lost",     bg: "bg-red-500",    active: "active:bg-red-400"    },
  { key: "hand",        emoji: "👋", label: "Question", bg: "bg-yellow-300", active: "active:bg-yellow-200" },
  { key: "thumbs_up",   emoji: "👍", label: "Got it",   bg: "bg-green-500",  active: "active:bg-green-400"  },
];

const EMPTY = { round: null, tally: null, responded: null, total_students: 0, my_response: null };

function timeOf(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function longDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

// Three columns of emoji + count + bar. `counts` is { thumbs_up, hand, thumbs_down }.
function TallyColumns({ counts, responded, showTally, myResponse, canVote, onVote, compact = false }) {
  return (
    <div className={`flex justify-around w-full ${compact ? "pt-2 pb-1" : "pt-4 pb-2"}`}>
      {RESPONSES.map(({ key, emoji, label: name, bg, active }) => {
        const count = counts?.[key] ?? 0;
        const pct   = showTally && responded > 0 ? Math.round((count / responded) * 100) : 0;
        const mine  = myResponse === key;
        return (
          <div key={key} className={`flex flex-col items-center gap-1.5 ${compact ? "w-20" : "w-24"}`}>
            <button
              type="button"
              onClick={() => onVote?.(key)}
              disabled={!canVote}
              aria-label={name}
              aria-pressed={mine}
              className={`emoji-btn ${bg} ${canVote ? active : "cursor-default"} ${
                mine ? "ring-4 ring-offset-2 ring-blue-400 scale-110" : ""
              } ${!canVote && !showTally && !mine ? "opacity-50" : ""} ${compact ? "scale-75 -my-2" : ""} transition-all`}
            >
              <p className="text">{emoji}</p>
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">{name}</span>
            {showTally && (
              <div className="w-full flex flex-col items-center gap-1">
                <span className="text-sm font-semibold std-text tabular-nums">
                  {count} <span className="text-xs font-normal text-slate-400">({pct}%)</span>
                </span>
                <div className="h-2 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function shortDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// ── Prepared checks for a day (professor only) ───────────────────────────────
function PreparedChecks({ title, rounds, canStart, startDisabledReason, onStart, onDelete, busy }) {
  return (
    <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">{title}</h3>
      {rounds.length === 0 ? (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">None prepared.</p>
      ) : (
        <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-700" aria-label={title}>
          {rounds.map((r) => (
            <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold std-text break-words">{r.label || "Untitled check"}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="white-btn text-xs py-1.5 border border-slate-200 dark:border-slate-700"
                  onClick={() => onDelete(r)}
                  disabled={busy}
                  aria-label={`Delete prepared check: ${r.label || "Untitled check"}`}
                >
                  Delete
                </button>
                {canStart && (
                  <button
                    type="button"
                    className="blue-btn text-xs py-1.5"
                    onClick={() => onStart(r)}
                    disabled={busy || !!startDisabledReason}
                    title={startDisabledReason ?? undefined}
                    aria-label={`Start prepared check: ${r.label || "Untitled check"}`}
                  >
                    Start
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UnderstandCheck({ classId, date }) {
  const { isProfessor, preview } = useClassView();
  const today    = todayKey();
  const isToday  = date === today;
  const isFuture = date > today;

  const [state,   setState]   = useState(EMPTY);
  const [history, setHistory] = useState([]);
  const [label,   setLabel]   = useState("");
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState(null);

  const { round, tally, responded, total_students, my_response } = state;
  const isOpen    = !!round && !round.ended_at;
  const showTally = !!round && Array.isArray(tally) && (isProfessor || !!round.ended_at);
  const counts    = Object.fromEntries((tally ?? []).map((r) => [r.response, r.count]));

  // ── Current round (today only) ─────────────────────────────────────────────
  useEffect(() => {
    if (!classId) return;
    let ignore = false;
    api.get(`/api/classes/${classId}/understand`)
      .then((res) => { if (!ignore) setState(res.data); })
      .catch((err) => console.error("Failed to load understanding check:", err));
    return () => { ignore = true; };
  }, [classId]);

  // ── Rounds for the viewed day ──────────────────────────────────────────────
  const loadHistory = useCallback(() => {
    if (!classId || !date) return;
    api.get(`/api/classes/${classId}/understand/rounds`, { params: { date } })
      .then((res) => setHistory(res.data))
      .catch((err) => console.error("Failed to load check history:", err));
  }, [classId, date]);

  useEffect(() => { setHistory([]); loadHistory(); }, [loadHistory]);

  // ── Live updates ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onRound = (snap) => {
      setState((prev) => ({
        ...snap,
        my_response: snap.round && prev.round?.id === snap.round.id ? prev.my_response : null,
      }));
      loadHistory();
    };
    const onUpdate = ({ round_id, tally, responded, total_students }) => {
      setState((prev) => (prev.round?.id === round_id ? { ...prev, tally, responded, total_students } : prev));
    };
    // Prepared checks changed (another professor window, or a start/delete).
    const onPrepared = ({ date: changed }) => { if (changed === date) loadHistory(); };
    socket.on("understand:round",    onRound);
    socket.on("understand:update",   onUpdate);
    socket.on("understand:prepared", onPrepared);
    return () => {
      socket.off("understand:round",    onRound);
      socket.off("understand:update",   onUpdate);
      socket.off("understand:prepared", onPrepared);
    };
  }, [loadHistory, date]);

  // ── Actions ────────────────────────────────────────────────────────────────
  // prepare = save it for this day instead of starting now.
  async function startRound(prepare = false) {
    setBusy(true); setError(null);
    try {
      await api.post(`/api/classes/${classId}/understand/rounds`, {
        label: label.trim() || undefined, scheduled_for: date, prepare,
      });
      setLabel("");
      loadHistory();
    } catch (err) {
      setError(err.response?.data?.error ?? (prepare ? "Couldn't save the check." : "Couldn't start the check."));
    } finally {
      setBusy(false);
    }
  }

  async function startPrepared(r) {
    setBusy(true); setError(null);
    try {
      await api.post(`/api/classes/${classId}/understand/rounds/${r.id}/start`);
      loadHistory();
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't start the check.");
    } finally {
      setBusy(false);
    }
  }

  async function deletePrepared(r) {
    if (!window.confirm(`Delete the prepared check "${r.label || "Untitled check"}"?`)) return;
    setBusy(true); setError(null);
    try {
      await api.delete(`/api/classes/${classId}/understand/rounds/${r.id}`);
      loadHistory();
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't delete the check.");
    } finally {
      setBusy(false);
    }
  }

  async function endRound() {
    if (!round) return;
    setBusy(true); setError(null);
    try {
      await api.patch(`/api/classes/${classId}/understand/rounds/${round.id}/end`);
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't end the check.");
    } finally {
      setBusy(false);
    }
  }

  async function vote(key) {
    if (!isOpen || isProfessor || key === my_response) return;
    if (preview) { setError(PREVIEW_MESSAGE); return; }
    const previous = my_response;
    setState((prev) => ({ ...prev, my_response: key }));
    setError(null);
    try {
      await api.post(`/api/classes/${classId}/understand`, { response: key });
    } catch (err) {
      setState((prev) => ({ ...prev, my_response: previous }));
      setError(err.response?.data?.error ?? "Couldn't record your answer.");
    }
  }

  // Rounds that actually ran that day; students only get finished ones.
  const ran       = history.filter((r) => r.started_at);
  const dayRounds = isProfessor ? ran : ran.filter((r) => r.ended_at);
  // Prepared, not started (professor only; the server never sends them to students).
  const prepared  = isProfessor ? history.filter((r) => !r.started_at) : [];

  const labelInput = (onEnter) => (
    <input
      type="text"
      value={label}
      onChange={(e) => setLabel(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && !busy) onEnter(); }}
      maxLength={120}
      placeholder="What are you checking? (optional)"
      className="flex-1 std-text bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 rounded-md text-sm outline-blue-600 focus:ring-2 focus:ring-blue-500/20"
    />
  );

  const card = "w-full rounded-lg shadow-md p-4 sm:p-6 border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700";

  // ── Future day (professor planning): prepared checks + a form to add more ──
  if (isFuture) {
    return (
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading text="Understanding Check 🤔" />
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{longDate(date)}</span>
        </div>
        {isProfessor ? (
          <>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Prepare checks for this class. You'll start each one when you're ready on the day.
            </p>
            <div className="mt-3 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
              {labelInput(() => startRound(true))}
              <button type="button" className="blue-btn" onClick={() => startRound(true)} disabled={busy}>
                {busy ? "Saving…" : `Save for ${shortDate(date)}`}
              </button>
            </div>
            {error && <p className="mt-2 text-center text-xs text-red-400">{error}</p>}
            <PreparedChecks
              title={`Prepared for ${shortDate(date)}`}
              rounds={prepared}
              canStart={false}
              onDelete={deletePrepared}
              busy={busy}
            />
          </>
        ) : (
          <p className="mt-3 text-center text-xs text-slate-400 dark:text-slate-500">Nothing here yet.</p>
        )}
      </div>
    );
  }

  // ── Past day: that day's rounds as result cards, nothing live ──────────────
  if (!isToday) {
    return (
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading text="Understanding Check 🤔" />
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{longDate(date)}</span>
        </div>
        {prepared.length > 0 && (
          <PreparedChecks title="Prepared but never started" rounds={prepared} canStart={false} onDelete={deletePrepared} busy={busy} />
        )}
        {error && <p className="mt-2 text-center text-xs text-red-400">{error}</p>}

        {dayRounds.length === 0 ? (
          <p className="mt-3 text-center text-xs text-slate-400 dark:text-slate-500">
            No checks were run on this day.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-700">
            {dayRounds.map((r, i) => (
              <li key={r.id} className="py-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 mr-2">#{i + 1}</span>
                  <span className="font-semibold std-text">{r.label || "Untitled check"}</span>
                  {" · "}{timeOf(r.started_at)}{r.ended_at ? ` – ${timeOf(r.ended_at)}` : " · never ended"}
                </p>
                <TallyColumns
                  compact
                  counts={{ thumbs_up: r.thumbs_up, hand: r.hand, thumbs_down: r.thumbs_down }}
                  responded={r.responded}
                  showTally
                  canVote={false}
                />
                <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                  {r.responded} student{r.responded === 1 ? "" : "s"} responded
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Today: live round + today's list ───────────────────────────────────────
  const studentCanVote = isOpen && !isProfessor;

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading text="Understanding Check 🤔" />
        {isOpen ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600 dark:text-green-400">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" /> Live
          </span>
        ) : (
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">No check running</span>
        )}
      </div>

      {round ? (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          <span className="font-semibold std-text">{round.label || "Untitled check"}</span>
          {" · "}started {timeOf(round.started_at)}
          {round.ended_at && ` · ended ${timeOf(round.ended_at)}`}
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">No checks yet today.</p>
      )}

      <TallyColumns
        counts={counts}
        responded={responded}
        showTally={showTally}
        myResponse={my_response}
        canVote={studentCanVote}
        onVote={vote}
      />

      {showTally && (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          {responded} of {total_students} student{total_students === 1 ? "" : "s"} responded
        </p>
      )}

      {!isProfessor && (
        <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
          {isOpen
            ? my_response
              ? "Answer recorded. You can change it until the check ends."
              : "How are you doing with this? Tap one."
            : round?.ended_at && showTally
              ? "Here's how the class answered."
              : "Waiting for your professor to start a check."}
        </p>
      )}

      {isProfessor && (
        <div className="mt-3 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          {isOpen ? (
            <button type="button" className="blue-btn sm:ml-auto" onClick={endRound} disabled={busy}>
              {busy ? "Ending…" : "End check"}
            </button>
          ) : (
            <>
              {labelInput(() => startRound(false))}
              <button type="button" className="white-btn border border-slate-200 dark:border-slate-700" onClick={() => startRound(true)} disabled={busy}>
                Save for later
              </button>
              <button type="button" className="blue-btn" onClick={() => startRound(false)} disabled={busy}>
                {busy ? "Starting…" : "Start check"}
              </button>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-center text-xs text-red-400">{error}</p>}

      {isProfessor && (
        <PreparedChecks
          title="Prepared for today"
          rounds={prepared}
          canStart
          startDisabledReason={isOpen ? "End the current check first." : null}
          onStart={startPrepared}
          onDelete={deletePrepared}
          busy={busy}
        />
      )}

      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Today's checks
        </h3>
        {dayRounds.length === 0 ? (
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-700">
            {dayRounds.map((r) => (
              <li key={r.id} className="py-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs">
                <span className="std-text font-medium truncate">
                  {r.label || "Untitled check"}
                  <span className="ml-2 font-normal text-slate-400">
                    {timeOf(r.started_at)}{r.ended_at ? ` – ${timeOf(r.ended_at)}` : " · live"}
                  </span>
                </span>
                <span className="tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                  👍 {r.thumbs_up} · 👋 {r.hand} · 👎 {r.thumbs_down}
                  <span className="text-slate-400"> ({r.responded} responded)</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default UnderstandCheck;
