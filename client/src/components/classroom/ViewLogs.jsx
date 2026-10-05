// src/components/classroom/ViewLogs.jsx
// Day navigator for the class page: prev / next arrows, a button that opens
// the full-year calendar, and a "Today" shortcut. Students stop at today;
// professors get a later maxDate so they can plan future classes.
import React, { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import YearCalendar, { MIN_DATE } from "./YearCalendar";

function formatLong(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

function ViewLogs({ date, today, maxDate = today, handleDate, classId }) {
  const [calendarOpen, setCalendarOpen] = useState(false);

  function select(next) {
    if (next >= MIN_DATE && next <= maxDate) {
      handleDate({ target: { value: next } });
    }
  }

  function shiftDay(delta) {
    // Work in local calendar days; toISOString() would shift by the UTC offset.
    const [y, m, d] = date.split("-").map(Number);
    select(new Date(y, m - 1, d + delta).toLocaleDateString("en-CA"));
  }

  const navBtn = `flex items-center justify-center w-8 h-8 border border-gray-200 rounded-lg
                  text-gray-500 hover:bg-gray-100 disabled:opacity-35 disabled:cursor-default
                  dark:border-gray-700 dark:hover:bg-gray-800 transition-colors`;

  return (
    <div className="w-full p-2 sm:p-3 flex flex-wrap items-center gap-2">
      <span className="text-sm text-gray-500 whitespace-nowrap">Viewing logs for</span>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => shiftDay(-1)}
          disabled={date <= MIN_DATE}
          aria-label="Previous day"
          className={navBtn}
        >
          <ChevronLeft size={16} />
        </button>

        <button
          type="button"
          onClick={() => setCalendarOpen(true)}
          aria-haspopup="dialog"
          className="h-8 px-3 flex items-center gap-2 text-sm border border-gray-200 rounded-lg bg-white
                     text-gray-800 hover:bg-gray-100 dark:bg-gray-900 dark:border-gray-700 dark:text-white
                     dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-300 cursor-pointer
                     transition-colors whitespace-nowrap"
        >
          <CalendarDays size={16} className="text-gray-500" />
          {formatLong(date)}
        </button>

        <button
          type="button"
          onClick={() => shiftDay(1)}
          disabled={date >= maxDate}
          aria-label="Next day"
          className={navBtn}
        >
          <ChevronRight size={16} />
        </button>

        <button
          type="button"
          onClick={() => select(today)}
          className={`h-8 px-3 text-xs border rounded-lg transition-colors whitespace-nowrap
                      dark:border-gray-700
                      ${date === today
                        ? "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-100"
                        : "border-gray-200 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
        >
          Today
        </button>
      </div>

      {calendarOpen && (
        <YearCalendar
          classId={classId}
          selected={date}
          today={today}
          maxDate={maxDate}
          onSelect={(next) => { select(next); setCalendarOpen(false); }}
          onClose={() => setCalendarOpen(false)}
        />
      )}
    </div>
  );
}

export default ViewLogs;
