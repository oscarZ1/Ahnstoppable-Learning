// src/components/assistant/AssistantLauncher.jsx
// The assistant: a round button in the bottom-right corner of every signed-in
// page that opens a private chat panel, for students and professors alike.
// Professors set up course help for students here too ("Course help
// settings", below); there's no assistant card on the class page.
//
// It's a general AI assistant (Gemini 3.5 Flash-Lite) that also knows this website.
// The menu at the top of the panel picks what else it sees:
//   - "General help": no class (always available).
//   - a class: that class's posted material too. On a class page the menu
//     follows the page. If course help isn't available there (the professor
//     hasn't turned it on for students), the panel quietly gives general help.
//     The class's own professor always gets course help.
// The gear opens AssistantKeySettings (use your own Gemini API key). For a
// class the professor teaches, the sliders button opens its course-help
// settings (StudyAssistantSettings): on/off for students, instructions, notes,
// and the summary of what students asked.
//
// Open/closed and the last menu choice survive page changes (sessionStorage).
import React, { useEffect, useRef, useState } from "react";
import { useLocation, useMatch } from "react-router-dom";
import { MessageCircleQuestion, Settings, SlidersHorizontal, X, ArrowLeft } from "lucide-react";
import api from "../../api/axios";
import { useAuth } from "../../context/AuthContext";
import AssistantChat from "./AssistantChat";
import AssistantKeySettings from "./AssistantKeySettings";
import StudyAssistantSettings from "../classroom/StudyAssistantSettings";

const OPEN_KEY   = "assistant:open";
const CHOICE_KEY = "assistant:choice";
const SITE       = "site";
const SITE_ENDPOINT = "/api/me/assistant";

const classLabel = (c) => (c.section ? `${c.title} · ${c.section}` : c.title);

// Course help for one class, or general help when it isn't available there.
function CourseHelp({ classId }) {
  const endpoint = `/api/classes/${classId}/assistant`;
  const [data, setData] = useState(null);       // the class GET response
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let ignore = false;
    setData(null); setFailed(false);
    api.get(endpoint)
      .then((res) => { if (!ignore) setData(res.data); })
      .catch(() => { if (!ignore) setFailed(true); });
    return () => { ignore = true; };
  }, [endpoint]);

  if (failed || (data && !(data.available ?? data.enabled))) {
    return <AssistantChat endpoint={SITE_ENDPOINT} mode="site" fill />;
  }
  if (!data) return <p className="mt-3 text-xs text-slate-400 animate-pulse">Loading…</p>;
  return <AssistantChat endpoint={endpoint} mode="course" initial={data} fill />;
}

const TITLES = { chat: "Study assistant", key: "Use your own Gemini key", course: "Course help settings" };

function Launcher({ userId }) {
  const routeClass = useMatch("/class/:classId/*")?.params.classId ?? null;
  const [open, setOpen]       = useState(() => sessionStorage.getItem(OPEN_KEY) === "1");
  const [choice, setChoice]   = useState(() => routeClass ?? sessionStorage.getItem(CHOICE_KEY) ?? SITE);
  const [view, setView]       = useState("chat");   // "chat" | "key" | "course"
  const [classes, setClasses] = useState(null);
  const [keyVersion, setKeyVersion] = useState(0);   // reload the chat after the key changes
  const buttonRef = useRef(null);
  const panelRef  = useRef(null);

  // On a class page, the panel follows the page.
  useEffect(() => { if (routeClass) setChoice(routeClass); }, [routeClass]);
  useEffect(() => { sessionStorage.setItem(OPEN_KEY, open ? "1" : "0"); }, [open]);
  useEffect(() => { sessionStorage.setItem(CHOICE_KEY, choice); }, [choice]);

  // The class menu, loaded the first time the panel opens.
  useEffect(() => {
    if (!open || classes) return;
    api.get("/api/classes")
      .then((res) => setClasses(res.data))
      .catch((err) => { console.error("Failed to load your classes:", err); setClasses([]); });
  }, [open, classes]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  // While open: Escape closes it from anywhere on the page, and focus moves
  // into the panel (the message box takes it once the chat has loaded).
  useEffect(() => {
    if (!open) return;
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const known = classes?.some((c) => String(c.id) === choice);
  const value = choice === SITE || known || !classes ? choice : SITE;
  // The class on the menu, if this professor teaches it.
  const ownClass = classes?.find((c) => String(c.id) === value && c.professor_id === userId) ?? null;

  // Leave the settings view if the menu moves off a class they teach.
  useEffect(() => { if (view === "course" && !ownClass) setView("chat"); }, [view, ownClass]);

  return (
    <>
      {open && (
        <div
          id="study-assistant-panel"
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-label="Study assistant"
          className="outline-none fixed z-40 inset-0 sm:inset-auto sm:bottom-24 sm:right-5 sm:w-[380px] sm:h-[560px] sm:max-h-[calc(100vh-7rem)]
            flex flex-col bg-white dark:bg-slate-900 sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-4"
        >
          <div className="flex items-center gap-2">
            {view !== "chat" ? (
              <button type="button" onClick={() => setView("chat")} aria-label="Back to the chat"
                className="p-1 rounded-md text-slate-500 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <ArrowLeft size={18} aria-hidden="true" />
              </button>
            ) : (
              <MessageCircleQuestion size={20} className="text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
            )}
            <h2 className="text-base font-semibold std-text flex-1 min-w-0 truncate">
              {TITLES[view]}
            </h2>
            {view === "chat" && ownClass && (
              <button type="button" onClick={() => setView("course")} aria-label="Course help settings"
                title={`Course help settings for ${classLabel(ownClass)}`}
                className="p-1 rounded-md text-slate-500 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <SlidersHorizontal size={18} aria-hidden="true" />
              </button>
            )}
            {view === "chat" && (
              <button type="button" onClick={() => setView("key")} aria-label="Use your own Gemini key"
                className="p-1 rounded-md text-slate-500 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <Settings size={18} aria-hidden="true" />
              </button>
            )}
            <button type="button" onClick={close} aria-label="Close the study assistant"
              className="p-1 rounded-md text-slate-500 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {view === "key" ? (
            <div className="mt-3 overflow-y-auto">
              <AssistantKeySettings onChange={() => setKeyVersion((v) => v + 1)} />
            </div>
          ) : view === "course" && ownClass ? (
            <div className="mt-3 overflow-y-auto">
              <p className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{classLabel(ownClass)}</p>
              <StudyAssistantSettings key={ownClass.id} classId={ownClass.id} />
            </div>
          ) : (
            <>
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="shrink-0">Help with</span>
                <select
                  aria-label="What the assistant helps with"
                  className="flex-1 min-w-0 std-text text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2 py-1.5 rounded-md"
                  value={value}
                  onChange={(e) => setChoice(e.target.value)}
                  disabled={!classes}
                >
                  <option value={SITE}>General help</option>
                  {(classes ?? []).map((c) => (
                    <option key={c.id} value={String(c.id)}>{classLabel(c)}</option>
                  ))}
                  {!classes && choice !== SITE && <option value={choice}>This class</option>}
                </select>
              </label>
              <div key={`${value}:${keyVersion}`} className="flex flex-col flex-1 min-h-0">
                {value === SITE
                  ? <AssistantChat endpoint={SITE_ENDPOINT} mode="site" fill />
                  : <CourseHelp classId={value} />}
              </div>
            </>
          )}
        </div>
      )}

      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls="study-assistant-panel"
        aria-label={open ? "Close the study assistant" : "Open the study assistant"}
        title="Study assistant"
        className={`fixed z-40 bottom-5 right-5 h-14 w-14 rounded-full shadow-lg flex items-center justify-center cursor-pointer
          bg-blue-600 hover:bg-blue-700 text-white transition-transform active:scale-95 ${open ? "hidden sm:flex" : ""}`}
      >
        {open ? <X size={24} aria-hidden="true" /> : <MessageCircleQuestion size={26} aria-hidden="true" />}
      </button>
    </>
  );
}

// Signed-in users (students and professors), not on the sign-in pages.
function AssistantLauncher() {
  const { user, token } = useAuth();
  const { pathname } = useLocation();
  if (!user || !token || pathname === "/" || pathname === "/register") return null;
  return <Launcher userId={user.id} />;
}

export default AssistantLauncher;
