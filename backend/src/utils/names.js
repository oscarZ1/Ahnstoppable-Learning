// src/utils/names.js
// Roster names arrive as "Last, First" (how the professor's class lists are
// written) or as "First Last". Store a natural display name plus a sort key.

const MAX_NAME = 100;

export function parseRosterName(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (!text) return null;

  let first, last;
  if (text.includes(',')) {
    [last, first] = text.split(',', 2).map((s) => s.trim());
  } else {
    const i = text.lastIndexOf(' ');
    [first, last] = i === -1 ? ['', text] : [text.slice(0, i), text.slice(i + 1)];
  }
  if (!last && !first) return null;
  if (!first) return { name: last, sort_name: last };
  if (!last)  return { name: first, sort_name: first };
  return { name: `${first} ${last}`, sort_name: `${last}, ${first}` };
}
