// src/utils/dates.js
// Calendar days as 'YYYY-MM-DD' in the browser's local time.
//
// Built from the date's own year/month/day numbers on purpose. The shortcut
// toLocaleDateString("en-CA") is allowed to vary between browsers, and some
// return "10/8/2026" instead, which the server rejects ("asked_date must be
// YYYY-MM-DD") and which broke the date navigator ("Invalid Date").

export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayKey() {
  return dateKey(new Date());
}
