# Ahnstoppable-Learning
Discussion Board App for Class

## Database schema

The schema lives in [`supabase/migrations`](supabase/README.md). GitHub Actions
applies new migrations to production (Supabase) when they're merged to `main`;
locally, `cd backend && npm run migrate` applies them. See
[`supabase/README.md`](supabase/README.md) for how to change the schema.

## Question summaries

The Questions card has a **✨ Summarize questions** button for the professor
and the class's students. It makes an AI overview of the day's questions (main
themes and common confusions) with Gemini 3.5 Flash-Lite (`GEMINI_MODEL`),
saves it, and reuses it until the questions change.

- No names, ids or answers are sent to the AI: only the questions' text.
- Students only ever see a summary that matches the day's current questions,
  so text that was since edited or deleted never shows; the professor also
  sees "Ideas for next class", which students don't get.
- Limits: `SUMMARIES_PER_HOUR` (default 10) per person, and
  `STUDENT_SUMMARIES_PER_CLASS_HOUR` (default 12) for all of a class's students
  together. Reusing a saved summary doesn't count.

## Study assistant

Students and professors get a round **assistant button in the bottom-right
corner** of every signed-in page. It opens a private chat with a
**general-purpose AI assistant**: they can ask it anything (any subject,
writing, code, teaching ideas, everyday questions). It always runs on **Gemini 3.5 Flash-Lite**
(`ASSISTANT_MODEL` in `backend/src/services/studyAssistant.js`, with no
fallback model), and it also knows:

- **The website** (always): how to use this site: anonymity, polls,
  understanding checks, talent points, and so on, from
  `backend/src/services/siteGuide.js` (`SITE_GUIDE` for everyone, plus
  `PROFESSOR_GUIDE` for professors: roster, planning days, results, settings);
  update it when a feature changes.
- **Course material** in a class: **off by default**. The class's professor
  turns it on under "Course help settings" (the sliders button in the corner
  panel, shown for a class they teach), and can give it
  instructions (which take priority over what the student asks, e.g. "don't
  solve the problem sets") and course notes there. When it's off, students'
  panel quietly gives general help instead. The class's own professor always
  gets course help in their class.
- **The student's own activity** in that class: their talent points and their
  own questions from the last 14 days, with any answers.

- **What it sees in course help:** the class title, the professor's course
  notes and instructions, discussion posts up to today (never a day the
  professor is still planning), answered questions with their answers, the
  polls and understanding checks that were started, and the student's own
  activity above. Never comments, replies, likes, the roster, other students'
  activity, or anyone's name. The student's own messages are sent, not their
  name. General help sees only the guide and the titles of the student's classes.
- **Privacy:** each student's chats are visible only to them. The professor gets
  an anonymous AI summary of what students asked in course help on a day
  ("What students asked the assistant"); the saved summary keeps no copy of the
  students' words, and the professor's own test messages are left out.
- **Retention:** messages (and those daily summaries) are deleted after
  `ASSISTANT_RETENTION_DAYS` (default 120) days, checked when the server starts
  and daily after that.
- **Limits:** 6 messages a minute and 40 an hour per student, plus daily caps on
  the shared Gemini key: `ASSISTANT_DAILY_CLASS_LIMIT` (default 300) per class
  and `ASSISTANT_DAILY_SITE_LIMIT` (default 300) for general help across
  everyone. Messages answered with a student's own key don't count toward the
  daily caps.

### Students' own Gemini keys

A student with their own **Google Gemini API key** (from Google AI Studio) can
add it under the gear in the assistant panel; the assistant then answers with
their account, using the same model, rules and prompts. A Gemini app
subscription is not an API key and can't be used this way.

- Turned on by setting `AI_KEY_ENCRYPTION_SECRET` on the backend
  (`openssl rand -base64 32`). Without it, the option is hidden.
- The key is checked with a tiny test request before it's saved, stored
  encrypted (AES-256-GCM), and never sent back to the browser or logged; only
  its last four characters are shown. Changing the secret makes saved keys
  unreadable, and students add them again.
- Adding a key is limited to 5 tries per 15 minutes per account, failed tries
  included, so the site can't be used to test stolen keys.
- With their own key, the student's messages (and, in course help, the class
  material) go to Google under the student's own account terms; the panel says
  so.

**Planned (phase 2):** an MCP connector so students can add this website to
their own Claude or ChatGPT app. The website would control what class data
their assistant gets, but not what it says.

Before turning course help on for real classes: decide on Gemini's paid tier
with the department (the free tier is small, and its data terms cover what
students type), tell school IT about the retention and anonymous-summary design
(FERPA), and pilot it with one section.

## Known risks

**First-time account claiming.** Students sign in by picking their class and
name. `GET /api/auth/classes/:id/students` is public and lists every roster
name with whether that student has set a password yet. Until a student creates
their password (and again right after their professor resets it),
`POST /api/auth/student-setup` lets *anyone* set it, so a classmate could claim
the account and post as that student. Professors should ask students to sign in
soon after they're added, and reset a password right away if a student reports
they can't get in.

Planned fix: issue a short one-time setup code when a student is added to the
roster or has their password reset, show it only to the professor, and require
it in `student-setup`.
