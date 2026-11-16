# Browser tests

The `e2e/` folder holds automated tests that use the real website in Chrome,
signed in as a professor and as students, the way people actually use it.

## What they cover

| File | What it checks |
|---|---|
| `student.spec.js` | First-time sign-in creates a password. A student posts a comment, replies to a classmate, answers an understanding check, and votes in a poll (and changes the vote). Students never see who voted. |
| `professor.spec.js` | The professor comments and replies (students see it live, with the professor's name), runs an understanding check and watches answers arrive, creates a poll and sees who voted live, writes polls of any length (long answers wrap onto new lines in the form), and "View as student" shows the student layout without sending anything. |
| `question-replies.spec.js` | Under the professor's answer in the Questions card, a student replies (shown as "You" to them, "Anonymous" to classmates, with their name to the professor, all live), the professor replies back, and replies survive a reload. Replying before the question is answered is refused. |
| `questions-actions.spec.js` | Edit, delete and thumbs up across the Questions card: students on their own questions and replies (live for classmates, "(edited)" shown), the professor editing/removing answers (replies go with a removed answer) and deleting any question, and the server refusing edits/deletes on other people's posts. |
| `questions.spec.js` | A student whose browser formats dates as M/D/YYYY still sees the right day and can ask questions. Unreadable or wrong dates are filed under today. Rejected questions don't count toward the limit, and the 6th real question in a minute is blocked. The professor's discussion post shows no time. |
| `results.spec.js` | The Results page lists every poll and understanding check with who answered what, and both CSV downloads contain the answers. Students can't open it. |
| `threads.spec.js` | Students can keep replying in a thread; the reply box opens right under whatever was clicked (the comment, or a reply). The comment box grows with the text, shrinks back, and takes up to 1000 characters (the server enforces the same limit). The class page shows the class name for the professor ("You're teaching") and students, and in the browser tab. |
| `assistant.spec.js` | Course help from the corner assistant: off by default (the panel quietly offers general help instead, with no notice, and sending is refused), the professor turns it on with instructions and notes, a student chats (Enter sends, Shift+Enter is a new line) and the chat survives a reload. What reaches the AI: today's post, the notes, an answered question with its answer, the general-assistant rules and website guide, and the previous turn, always to Gemini 3.5 Flash-Lite with low thinking, but never a planned future post or anyone's name. Each student sees only their own thread. When the AI fails the error shows under the box, the text stays and nothing is saved; refusals and bad input are refused cleanly. The 7th message in a minute is blocked, Clear chat empties the thread, and messages past the 120-day window aren't returned. The professor's summary of what students asked is anonymous, leaves out the professor's own messages and keeps no copy of students' words; students can't reach it or the settings. |
| `assistant-widget.spec.js` | The corner assistant: the button shows for students and professors on every signed-in page (never for signed-out visitors), Escape closes it, and on a class page it follows the page. A professor gets course help in their own class even when it's off for students, with the professor's guide and no "own activity", and general help knows they're a professor; students still can't send course messages while it's off. General help is a general assistant with the site guide, on Gemini 3.5 Flash-Lite, in its own thread, with no class material or names. Course help includes the student's own questions and talent points but nobody else's. Own Gemini keys (no provider or model choice): a rejected key isn't saved; a good one is checked first, shown only as ••••last4, never returned or stored in plain text, and then answers instead of the shared key, with the same model, in general and course help; removing the key goes back to the shared key; adding a key is validated and limited to 5 tries per 15 minutes. |
| `summary.spec.js` | The AI summary of a day's questions in the Questions card: created on demand, saved and shown again without another AI call, Refresh after new questions (and no AI call when nothing changed, or when two requests arrive at once), friendly errors when the AI declines, is rate-limited, or is overloaded, a retry or the fallback model when that can help, a countdown when Google says how long to wait, no student names sent to the AI. Students can summarize too: they only ever see a summary that matches the current questions (an edit hides it right away), never the professor's ideas for next class, and a class's students share a limit per hour that the professor's summaries don't count toward. Uses a fake Gemini API (`e2e/fake-gemini.js`), so there's no API key or cost. |
| `class-switcher.spec.js` | A professor who teaches several classes switches between them from the class page ("Switch class"); the page starts fresh on today for the new class, and the switcher is hidden in "View as student" and for students. |
| `edit-delete.spec.js` | A student edits and deletes their own comment and reply (shown as "You", marked "(edited)", updated and removed live for classmates, participation points taken back on delete). Students can't edit or delete others' comments and still don't learn who wrote them; the professor can delete any comment but can't edit a student's words; edit length is validated. |
| `hardening.spec.js` | Only the class's own professor sees student names or can run the class (another professor who is merely a member can't), and join-by-code is gone. Students get 404 on comments of a post planned for a future day. Bad or oversized ids are 404s, not server errors. A refused reply shows its error inside the reply box and keeps the text; the box and its draft survive "Hide replies". After a dropped connection, replies and deletions made meanwhile appear without a reload. A double-clicked like ends in the same state a reload shows. |
| `leftovers.spec.js` | A check and a poll the professor forgot to end on an earlier day don't carry over: today shows nothing running, votes into them are refused, they show as ended at midnight on their own day, and new ones can start. |
| `likes.spec.js` | Liking comments and replies: one like per person (liking twice counts once), counts update live for classmates, unliking works, and both counts and your own heart survive a reload. Who liked is never sent. |
| `planning.spec.js` | The professor plans a future day (discussion, poll and check) and students can't see or reach any of it. Polls and checks prepared for today stay hidden until the professor clicks Start. The app uses the class timezone even though the database runs in UTC. |
| `sessions.spec.js` | Two accounts in tabs of one browser: signing in or out in one tab switches the other tabs too. This guards against the "Only students can vote." bug. |

## Running them

You need Google Chrome and the local Postgres the app already uses.

```
cd e2e
npm install        # first time only
npm test
```

`npm run test:headed` shows the browser while the tests run, and
`npm run report` opens a report with screenshots and traces of any failure.

## How it works

- Each run drops and rebuilds a separate database called `ahnstoppable_test` on
  your local Postgres from the same `supabase/migrations` files production uses
  (via `backend/scripts/migrate.js`), then adds a
  test professor (`prof@test.local`), the class "TEST 101 · E2E", three students
  and one discussion post. Your real local data and production are never touched.
- The tests refuse to run unless that database is on `localhost` and its name ends
  in `_test`. To use a different one, set `E2E_DATABASE_URL`.
- The tests start their own backend on port 4310 and website on port 5310, and
  stop them afterwards, so they don't clash with anything already running.
- Like production, the test database runs in UTC while the app runs with
  `APP_TIMEZONE=America/Los_Angeles`, and the browser uses that timezone too.
- The AI summary and the study assistant talk to `e2e/fake-gemini.js` on port 4320 instead of the real
  Gemini API, through the real SDK, for both the shared key and students' own keys.
- Rate limits stay switched on, exactly as in production.
