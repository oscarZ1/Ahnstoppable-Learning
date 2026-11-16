// src/components/classroom/StudyAssistantSettings.jsx
// The class professor's study-assistant card: turn it on or off, give it
// instructions and course notes, and read an anonymous AI summary of what
// students asked it on the viewed day. Students' chats themselves are private
// and never shown here. The professor chats with the assistant from the corner
// button (components/assistant/AssistantLauncher.jsx), like students.
import React, { useEffect, useState } from "react";
import SectionHeading from "../ui/SectionHeading";
import AutoGrowTextarea from "../ui/AutoGrowTextarea";
import api from "../../api/axios";
import QuestionSummary from "./QuestionSummary";

const FIELD = "w-full std-text text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20 placeholder-slate-400 dark:placeholder-slate-500";

function StudyAssistantSettings({ classId, date }) {
  const [saved, setSaved] = useState(null);   // what the server has
  const [form,  setForm]  = useState(null);   // what's being edited
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!classId) return;
    let ignore = false;
    api.get(`/api/classes/${classId}/assistant/settings`)
      .then((res) => { if (!ignore) { setSaved(res.data); setForm(res.data); } })
      .catch((err) => console.error("Failed to load study-assistant settings:", err));
    return () => { ignore = true; };
  }, [classId]);

  if (!form) return null;
  const maxInstructions = saved.max_instructions ?? 2000;
  const maxNotes        = saved.max_course_notes ?? 20000;
  const changed = form.enabled !== saved.enabled || form.instructions !== saved.instructions
    || form.course_notes !== saved.course_notes;

  async function save() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const { data } = await api.put(`/api/classes/${classId}/assistant/settings`, {
        enabled: form.enabled, instructions: form.instructions, course_notes: form.course_notes,
      });
      const next = { ...saved, ...data };
      setSaved(next); setForm(next);
      setNotice(data.enabled ? "Saved. Students can use the study assistant." : "Saved. The study assistant is off for students.");
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't save the settings.");
    } finally {
      setBusy(false);
    }
  }

  const set = (key) => (e) => { setNotice(null); setForm((f) => ({ ...f, [key]: e.target.value })); };

  return (
    <div className="w-full rounded-lg shadow-md p-4 sm:p-6 border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading text="Study Assistant 🤖" />
        <label className="flex items-center gap-2 text-sm std-text cursor-pointer">
          <input
            type="checkbox"
            role="switch"
            checked={form.enabled}
            onChange={(e) => { setNotice(null); setForm((f) => ({ ...f, enabled: e.target.checked })); }}
            className="h-4 w-4 accent-blue-600"
          />
          On for students
        </label>
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Everyone, you included, has a general AI assistant (Gemini 3.5 Flash-Lite) in the corner of every page.
        Turning this on lets students' assistant also see this class's discussions up to today (never planned days),
        answered questions, the polls and checks you've run, and the notes below; yours always can. It never sees
        comments, names or the roster. Your instructions below come first, for example to limit help on graded work.
      </p>

      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" htmlFor="assistant-instructions">
        Instructions for the assistant
      </label>
      <AutoGrowTextarea
        id="assistant-instructions"
        minRows={2}
        maxHeight={240}
        value={form.instructions}
        onChange={set("instructions")}
        maxLength={maxInstructions}
        placeholder="e.g. Don't give answers to the weekly problem sets. Use examples from advertising."
        className={`mt-1 ${FIELD}`}
      />
      <p className="text-right text-xs text-slate-400">{form.instructions.length} / {maxInstructions.toLocaleString()}</p>

      <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" htmlFor="assistant-notes">
        Course notes
      </label>
      <AutoGrowTextarea
        id="assistant-notes"
        minRows={4}
        maxHeight={360}
        value={form.course_notes}
        onChange={set("course_notes")}
        maxLength={maxNotes}
        placeholder="Key concepts, syllabus points, definitions… anything you want the assistant to base its answers on."
        className={`mt-1 ${FIELD}`}
      />
      <p className="text-right text-xs text-slate-400">{form.course_notes.length} / {maxNotes.toLocaleString()}</p>

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {notice && !error && <span role="status" className="text-xs text-green-600 dark:text-green-400">{notice}</span>}
        {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
        <button type="button" className="blue-btn text-xs py-1.5" onClick={save} disabled={busy || !changed}>
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>

      {/* What students asked it that day, anonymously */}
      <div className="mt-5 border-t border-slate-100 dark:border-slate-700 pt-4">
        <h3 className="text-sm font-semibold std-text">What students asked the assistant</h3>
        <QuestionSummary
          key={date}
          classId={classId}
          date={date}
          endpoint={`/api/classes/${classId}/assistant/summary`}
          title="✨ What students asked the assistant"
          regionLabel="AI summary of study-assistant questions"
          buttonText="✨ Summarize assistant questions"
          description="An anonymous AI overview of what students asked the assistant on this day. Their chats stay private."
          emptyText="No student messages to the assistant on this day."
          noun="message"
        />
      </div>
    </div>
  );
}

export default StudyAssistantSettings;
