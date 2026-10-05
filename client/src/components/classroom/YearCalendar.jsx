// src/components/classroom/YearCalendar.jsx
// Full-year calendar picker shown as a modal. Every day up to maxDate (today
// for students, later for professors planning ahead) is clickable; days with
// activity get a marker (hover for counts), and days with prepared polls or
// checks get an amber marker (professors only).
import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import api from "../../api/axios";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

// The app launched in 2026; nothing earlier can have activity.
export const MIN_DATE = "2026-01-01";
const MIN_YEAR = Number(MIN_DATE.slice(0, 4));

// Local-calendar 'YYYY-MM-DD' for a (year, monthIndex, day) triple.
function toKey(year, month, day) {
  return new Date(year, month, day).toLocaleDateString("en-CA");
}

function activityLabel(a) {
  if (!a) return "";
  const parts = [];
  if (a.posts)     parts.push(`${a.posts} post${a.posts === 1 ? "" : "s"}`);
  if (a.comments)  parts.push(`${a.comments} comment${a.comments === 1 ? "" : "s"}`);
  if (a.questions) parts.push(`${a.questions} question${a.questions === 1 ? "" : "s"}`);
  if (a.prepared)  parts.push(`${a.prepared} prepared poll${a.prepared === 1 ? "" : "s"}/check${a.prepared === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function MonthGrid({ year, month, selected, today, maxDate, activity, onSelect }) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <h4 className="std-text text-sm mb-2">{MONTHS[month]}</h4>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
            {w}
          </span>
        ))}

        {cells.map((day, i) => {
          if (day === null) return <span key={`blank-${i}`} />;

          const key        = toKey(year, month, day);
          const disabled   = key > maxDate || key < MIN_DATE;
          const isSelected = key === selected;
          const isToday    = key === today;
          const act        = activity[key];

          const classes = [
            "relative mx-auto h-7 w-7 rounded-full text-xs flex items-center justify-center transition-colors",
            disabled
              ? "text-slate-300 dark:text-slate-600 cursor-default"
              : "cursor-pointer hover:bg-blue-100 dark:hover:bg-slate-700",
            isSelected
              ? "bg-blue-600 text-white hover:bg-blue-600 font-bold"
              : disabled ? "" : "text-slate-800 dark:text-slate-200",
            isToday && !isSelected ? "ring-1 ring-blue-400" : "",
            act && !isSelected ? "font-bold" : "",
          ].join(" ");

          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(key)}
              title={act ? `${key}: ${activityLabel(act)}` : key}
              aria-label={act ? `${key}, ${activityLabel(act)}` : key}
              aria-pressed={isSelected}
              className={classes}
            >
              {day}
              {act && (
                <span
                  className={`absolute bottom-0.5 h-1 w-1 rounded-full ${
                    isSelected ? "bg-white" : act.posts || act.comments || act.questions ? "bg-blue-500" : "bg-amber-500"
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function YearCalendar({ classId, selected, today, maxDate = today, onSelect, onClose }) {
  const [year, setYear]         = useState(Number(selected.slice(0, 4)));
  const [activity, setActivity] = useState({});
  const [loadError, setLoadError] = useState(null);
  const maxYear = Number(maxDate.slice(0, 4));

  // Activity markers for the visible year
  useEffect(() => {
    if (!classId) return;
    let ignore = false;
    setLoadError(null);
    api
      .get(`/api/classes/${classId}/posts/dates`, { params: { year } })
      .then((res) => {
        if (ignore) return;
        setActivity(Object.fromEntries(res.data.map((r) => [r.date, r])));
      })
      .catch((err) => {
        if (ignore) return;
        console.error("Failed to load calendar activity:", err);
        setLoadError("Couldn't load activity markers.");
      });
    return () => { ignore = true; };
  }, [classId, year]);

  // Escape closes
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-gray-700/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a day"
        className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-xl shadow-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              disabled={year <= MIN_YEAR}
              aria-label="Previous year"
              className="flex items-center justify-center w-8 h-8 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-35 disabled:cursor-default dark:border-gray-700 dark:hover:bg-gray-800 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="std-text text-lg tabular-nums w-14 text-center">{year}</span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              disabled={year >= maxYear}
              aria-label="Next year"
              className="flex items-center justify-center w-8 h-8 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-35 disabled:cursor-default dark:border-gray-700 dark:hover:bg-gray-800 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="hidden sm:flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" /> has discussions
            </span>
            {loadError && <span className="text-red-400">{loadError}</span>}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Twelve months */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-4">
          {MONTHS.map((_, month) => (
            <MonthGrid
              key={month}
              year={year}
              month={month}
              selected={selected}
              today={today}
              maxDate={maxDate}
              activity={activity}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default YearCalendar;
