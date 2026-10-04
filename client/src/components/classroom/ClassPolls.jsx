// src/components/classroom/ClassPolls.jsx
// Kahoot-style polls. The professor writes a question with 2–6 answers and
// opens it; students pick one (and may change it) until the professor closes
// the poll. Professors watch live bars with the names of who picked what.
// Students vote blind and see the bars, counts only, once the poll closes.
//
// Day-specific like UnderstandCheck: today shows the live poll plus today's
// list; any other day shows that day's polls as result cards only.
import React, { useCallback, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import SectionHeading from "../ui/SectionHeading";
import api from "../../api/axios";
import socket from "../../api/socket";
import { useClassView, PREVIEW_MESSAGE } from "../../context/ClassViewContext";

const MAX_QUESTION = 300;
const MAX_OPTION   = 100;
const MIN_OPTIONS  = 2;
const MAX_OPTIONS  = 6;

const EMPTY = { poll: null, tally: null, responded: null, total_students: 0, my_option_id: null };

const inputClass =
  "std-text text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20";

function timeOf(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function longDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// ── Horizontal bar graph, one bar per option ─────────────────────────────────
function PollBars({ options, tally, responded, myOptionId, showNames, compact = false }) {
  const byId = Object.fromEntries((tally ?? []).map((t) => [t.option_id, t]));
  const top  = Math.max(0, ...(tally ?? []).map((t) => t.count));
  return (
    <ul className={`flex flex-col ${compact ? "gap-2 mt-2" : "gap-3 mt-4"}`}>
      {options.map((o) => {
        const row    = byId[o.id];
        const count  = row?.count ?? 0;
        const pct    = responded > 0 ? Math.round((count / responded) * 100) : 0;
        const mine   = myOptionId === o.id;
        const leader = count > 0 && count === top;
        return (
          <li key={o.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="std-text break-words min-w-0">
                {o.text}
                {mine && (
                  <span className="ml-2 text-xs font-semibold text-blue-600 dark:text-blue-400">Your pick</span>
                )}
              </span>
              <span className="std-text tabular-nums whitespace-nowrap">
                {count} <span className="text-xs font-normal text-slate-400">({pct}%)</span>
              </span>
            </div>
            <div
              className={`mt-1 ${compact ? "h-2" : "h-4"} w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden ${
                mine ? "ring-2 ring-blue-400" : ""
              }`}
            >
              <div
                className={`h-full rounded-full transition-all duration-500 ${leader ? "bg-blue-600" : "bg-blue-400"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {showNames && row?.voters?.length > 0 && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {row.voters.map((v) => v.name).join(", ")}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Student answer buttons while the poll is open ────────────────────────────
function OptionButtons({ options, myOptionId, onVote }) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      {options.map((o) => {
        const mine = myOptionId === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onVote(o.id)}
            aria-pressed={mine}
            className={`w-full text-left px-4 py-3 rounded-md border std-text text-sm transition-all cursor-pointer ${
              mine
                ? "ring-2 ring-blue-400 border-blue-400 bg-blue-50 dark:bg-blue-900/30"
                : "border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40"
            }`}
          >
            {o.text}
          </button>
        );
      })}
    </div>
  );
}

// ── Professor form: question + 2–6 answers ───────────────────────────────────
function PollComposer({ onSubmit, busy }) {
  const [question, setQuestion] = useState("");
  const [options,  setOptions]  = useState(["", ""]);

  const valid = question.trim() && options.length >= MIN_OPTIONS && options.every((o) => o.trim());

  function setOption(i, value) {
    setOptions((prev) => prev.map((o, j) => (j === i ? value : o)));
  }
  function addOption() {
    setOptions((prev) => (prev.length < MAX_OPTIONS ? [...prev, ""] : prev));
  }
  function removeOption(i) {
    setOptions((prev) => (prev.length > MIN_OPTIONS ? prev.filter((_, j) => j !== i) : prev));
  }

  async function submit() {
    if (!valid || busy) return;
    const ok = await onSubmit({ question: question.trim(), options: options.map((o) => o.trim()) });
    if (ok) { setQuestion(""); setOptions(["", ""]); }
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <textarea
        rows={2}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        maxLength={MAX_QUESTION}
        placeholder="Ask the class a question…"
        className={`w-full resize-none ${inputClass}`}
      />
      <span className="self-end text-xs text-slate-400 dark:text-slate-500 tabular-nums">
        {question.length} / {MAX_QUESTION}
      </span>

      {options.map((text, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-4 text-xs text-slate-400 dark:text-slate-500 tabular-nums">{i + 1}.</span>
          <input
            type="text"
            value={text}
            onChange={(e) => setOption(i, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            maxLength={MAX_OPTION}
            placeholder={`Option ${i + 1}`}
            className={`flex-1 min-w-0 ${inputClass}`}
          />
          <button
            type="button"
            className="white-btn px-2 py-2"
            onClick={() => removeOption(i)}
            disabled={options.length <= MIN_OPTIONS}
            aria-label={`Remove option ${i + 1}`}
          >
            <X size={14} />
          </button>
        </div>
      ))}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="white-btn text-xs py-1.5"
          onClick={addOption}
          disabled={options.length >= MAX_OPTIONS}
        >
          <Plus size={14} /> Add option
        </button>
        <button type="button" className="blue-btn" onClick={submit} disabled={!valid || busy}>
          {busy ? "Starting…" : "Start poll"}
        </button>
      </div>
    </div>
  );
}

// ── One poll in a day's list ─────────────────────────────────────────────────
function PollResultCard({ snap, index, showNames }) {
  const { poll, tally, responded, total_students } = snap;
  return (
    <li className="py-3">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 mr-2">#{index + 1}</span>
        <span className="font-semibold std-text">{poll.question}</span>
        {" · "}{timeOf(poll.created_at)}{poll.closed_at ? ` – ${timeOf(poll.closed_at)}` : " · live"}
      </p>
      {Array.isArray(tally) && (
        <>
          <PollBars compact options={poll.options} tally={tally} responded={responded} showNames={showNames} />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {showNames
              ? `${responded} of ${plural(total_students, "student")} responded`
              : `${plural(responded, "student")} responded`}
          </p>
        </>
      )}
    </li>
  );
}

function ClassPolls({ classId, date }) {
  const { isProfessor, preview } = useClassView();
  const today   = new Date().toLocaleDateString("en-CA");
  const isToday = date === today;

  const [state,   setState]   = useState(EMPTY);
  const [history, setHistory] = useState([]);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState(null);

  const { poll, tally, responded, total_students, my_option_id } = state;
  const isOpen    = !!poll && !poll.closed_at;
  const showTally = !!poll && Array.isArray(tally);

  // ── Current poll (today only) ──────────────────────────────────────────────
  useEffect(() => {
    if (!classId) return;
    let ignore = false;
    api.get(`/api/classes/${classId}/polls/current`)
      .then((res) => { if (!ignore) setState(res.data); })
      .catch((err) => console.error("Failed to load poll:", err));
    return () => { ignore = true; };
  }, [classId]);

  // ── Polls for the viewed day ───────────────────────────────────────────────
  const loadHistory = useCallback(() => {
    if (!classId || !date) return;
    api.get(`/api/classes/${classId}/polls`, { params: { date } })
      .then((res) => setHistory(res.data))
      .catch((err) => console.error("Failed to load poll history:", err));
  }, [classId, date]);

  useEffect(() => { setHistory([]); loadHistory(); }, [loadHistory]);

  // ── Live updates ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onState = (snap) => {
      setState((prev) => ({
        ...snap,
        my_option_id: snap.poll && prev.poll?.id === snap.poll.id ? prev.my_option_id : null,
      }));
      loadHistory();
    };
    const onUpdate = ({ poll_id, tally, responded, total_students }) => {
      setState((prev) => (prev.poll?.id === poll_id ? { ...prev, tally, responded, total_students } : prev));
      setHistory((prev) => prev.map((s) => (s.poll.id === poll_id ? { ...s, tally, responded, total_students } : s)));
    };
    socket.on("poll:state",  onState);
    socket.on("poll:update", onUpdate);
    return () => {
      socket.off("poll:state",  onState);
      socket.off("poll:update", onUpdate);
    };
  }, [loadHistory]);

  // ── Actions ────────────────────────────────────────────────────────────────
  async function createPoll(body) {
    setBusy(true); setError(null);
    try {
      const { data } = await api.post(`/api/classes/${classId}/polls`, body);
      setState(data);
      return true;
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't start the poll.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function closePoll() {
    if (!poll) return;
    setBusy(true); setError(null);
    try {
      const { data } = await api.patch(`/api/classes/${classId}/polls/${poll.id}/close`);
      setState(data);
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't close the poll.");
    } finally {
      setBusy(false);
    }
  }

  async function vote(optionId) {
    if (!isOpen || isProfessor || optionId === my_option_id) return;
    if (preview) { setError(PREVIEW_MESSAGE); return; }
    const previous = my_option_id;
    setState((prev) => ({ ...prev, my_option_id: optionId }));
    setError(null);
    try {
      await api.post(`/api/classes/${classId}/polls/${poll.id}/votes`, { option_id: optionId });
    } catch (err) {
      setState((prev) => ({ ...prev, my_option_id: previous }));
      setError(err.response?.data?.error ?? "Couldn't record your answer.");
    }
  }

  // Students only get closed polls in the day list.
  const dayPolls = isProfessor ? history : history.filter((s) => s.poll.closed_at);

  const card = "w-full rounded-lg shadow-md p-4 sm:p-6 border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700";

  // ── Past day: that day's polls as result cards, nothing live ───────────────
  if (!isToday) {
    return (
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading text="Polls 📊" />
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{longDate(date)}</span>
        </div>
        {dayPolls.length === 0 ? (
          <p className="mt-3 text-center text-xs text-slate-400 dark:text-slate-500">
            No polls were run on this day.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-700">
            {dayPolls.map((s, i) => (
              <PollResultCard key={s.poll.id} snap={s} index={i} showNames={isProfessor} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Today: live poll + today's list ────────────────────────────────────────
  const earlier = dayPolls.filter((s) => s.poll.id !== poll?.id);

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading text="Polls 📊" />
        {isOpen ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600 dark:text-green-400">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" /> Live
          </span>
        ) : (
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">No poll running</span>
        )}
      </div>

      {poll ? (
        <>
          <p className="mt-2 text-lg std-text break-words">{poll.question}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            started {timeOf(poll.created_at)}
            {poll.closed_at && ` · closed ${timeOf(poll.closed_at)}`}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">No polls yet today.</p>
      )}

      {/* Professor: live bars with names, then close button or a new-poll form */}
      {isProfessor && (
        <>
          {showTally && (
            <>
              <PollBars options={poll.options} tally={tally} responded={responded} showNames />
              <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
                {responded} of {plural(total_students, "student")} responded
              </p>
            </>
          )}
          {isOpen ? (
            <div className="mt-3 flex">
              <button type="button" className="blue-btn ml-auto" onClick={closePoll} disabled={busy}>
                {busy ? "Closing…" : "Close poll & show results"}
              </button>
            </div>
          ) : (
            <div className={poll ? "mt-4 pt-3 border-t border-slate-200 dark:border-slate-700" : ""}>
              {poll && (
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  New poll
                </h3>
              )}
              <PollComposer onSubmit={createPoll} busy={busy} />
            </div>
          )}
        </>
      )}

      {/* Student: blind vote while open, bars once closed */}
      {!isProfessor && (
        <>
          {isOpen ? (
            <OptionButtons options={poll.options} myOptionId={my_option_id} onVote={vote} />
          ) : (
            showTally && (
              <PollBars options={poll.options} tally={tally} responded={responded} myOptionId={my_option_id} />
            )
          )}
          <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
            {isOpen
              ? my_option_id
                ? "Answer recorded. You can change it until the poll closes."
                : "Pick one. Results show when your professor closes the poll."
              : showTally
                ? `Here's how the class answered (${plural(responded, "response")}).`
                : "Waiting for your professor to start a poll."}
          </p>
        </>
      )}

      {error && <p className="mt-2 text-center text-xs text-red-400">{error}</p>}

      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Earlier today
        </h3>
        {earlier.length === 0 ? (
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-700">
            {earlier.map((s) => (
              <PollResultCard
                key={s.poll.id}
                snap={s}
                index={dayPolls.indexOf(s)}
                showNames={isProfessor}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ClassPolls;
