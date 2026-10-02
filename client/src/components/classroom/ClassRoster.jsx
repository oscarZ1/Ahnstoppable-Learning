// src/components/classroom/ClassRoster.jsx
// Professor-only roster. Students sign in by picking their name from this
// list, so adding a name here is how a student gets into the class. Names can
// be pasted straight from a class list, one per line, as "Last, First".
import React, { useCallback, useEffect, useState } from "react";
import SectionHeading from "../ui/SectionHeading";
import api from "../../api/axios";

const card = "w-full rounded-lg shadow-md p-4 sm:p-6 border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700";

function ClassRoster({ classId }) {
  const [students, setStudents] = useState([]);
  const [draft,    setDraft]    = useState("");
  const [busy,     setBusy]     = useState(false);
  const [notice,   setNotice]   = useState(null);
  const [error,    setError]    = useState(null);
  const [open,     setOpen]     = useState(true);

  const load = useCallback(() => {
    if (!classId) return;
    api.get(`/api/classes/${classId}/roster`)
      .then((res) => setStudents(res.data))
      .catch((err) => setError(err.response?.data?.error ?? "Couldn't load the roster."));
  }, [classId]);

  useEffect(() => { load(); }, [load]);

  async function addStudents() {
    const names = draft.split("\n").map((n) => n.trim()).filter(Boolean);
    if (!names.length || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const { data } = await api.post(`/api/classes/${classId}/roster`, { names });
      const parts = [`Added ${data.added.length}`];
      if (data.already_enrolled.length) parts.push(`${data.already_enrolled.length} already in the class`);
      setNotice(parts.join(", ") + ".");
      setDraft("");
      load();
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't add those names.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(s) {
    if (!window.confirm(`Reset ${s.name}'s password? They'll create a new one the next time they sign in.`)) return;
    setError(null); setNotice(null);
    try {
      await api.post(`/api/classes/${classId}/roster/${s.id}/reset-password`);
      setNotice(`${s.name} can now create a new password.`);
      load();
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't reset that password.");
    }
  }

  async function remove(s) {
    if (!window.confirm(`Remove ${s.name} from this class? Their posts and comments stay.`)) return;
    setError(null); setNotice(null);
    try {
      await api.delete(`/api/classes/${classId}/roster/${s.id}`);
      setStudents((prev) => prev.filter((x) => x.id !== s.id));
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't remove that student.");
    }
  }

  const notSetUp = students.filter((s) => !s.has_password).length;

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading text="Roster 👥" />
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
          {students.length} student{students.length === 1 ? "" : "s"}
          {notSetUp > 0 && ` · ${notSetUp} not signed in yet`}
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <label htmlFor="roster-names" className="text-sm text-slate-500 dark:text-slate-400">
          Add students. Paste names one per line, as <span className="font-semibold">Last, First</span>.
        </label>
        <textarea
          id="roster-names"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"Backstrom, Lauren\nBender, Ava"}
          className="w-full std-text text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20 resize-y"
        />
        <div className="flex justify-end">
          <button type="button" className="blue-btn" onClick={addStudents} disabled={busy || !draft.trim()}>
            {busy ? "Adding…" : "Add students"}
          </button>
        </div>
      </div>

      {notice && <p className="mt-2 text-xs text-green-600 dark:text-green-400">{notice}</p>}
      {error  && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
          aria-expanded={open}
        >
          {open ? "▾" : "▸"} Students in this class
        </button>

        {open && (students.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">No students yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-700">
            {students.map((s) => (
              <li key={s.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm std-text">
                  {s.sort_name ?? s.name}
                  {!s.has_password && (
                    <span className="ml-2 text-xs font-medium text-amber-600 dark:text-amber-400">Not signed in yet</span>
                  )}
                </span>
                <span className="flex gap-3">
                  {s.has_password && (
                    <button
                      type="button"
                      onClick={() => resetPassword(s)}
                      className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Reset password
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(s)}
                    className="text-xs font-semibold text-red-500 hover:underline cursor-pointer"
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

export default ClassRoster;
