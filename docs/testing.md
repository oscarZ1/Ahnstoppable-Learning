# Browser tests

The `e2e/` folder holds automated tests that use the real website in Chrome,
signed in as a professor and as students, the way people actually use it.

## What they cover

| File | What it checks |
|---|---|
| `student.spec.js` | First-time sign-in creates a password. A student posts a comment, replies to a classmate, answers an understanding check, and votes in a poll (and changes the vote). Students never see who voted. |
| `professor.spec.js` | The professor comments and replies (students see it live, with the professor's name), runs an understanding check and watches answers arrive, creates a poll and sees who voted live, and "View as student" shows the student layout without sending anything. |
| `questions.spec.js` | A student whose browser formats dates as M/D/YYYY still sees the right day and can ask questions. Unreadable or wrong dates are filed under today. Rejected questions don't count toward the limit, and the 6th real question in a minute is blocked. The professor's discussion post shows no time. |
| `results.spec.js` | The Results page lists every poll and understanding check with who answered what, and both CSV downloads contain the answers. Students can't open it. |
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
  your local Postgres, using the same migration runner as production, then adds a
  test professor (`prof@test.local`), the class "TEST 101 · E2E", three students
  and one discussion post. Your real local data and production are never touched.
- The tests refuse to run unless that database is on `localhost` and its name ends
  in `_test`. To use a different one, set `E2E_DATABASE_URL`.
- The tests start their own backend on port 4310 and website on port 5310, and
  stop them afterwards, so they don't clash with anything already running.
- Like production, the test database runs in UTC while the app runs with
  `APP_TIMEZONE=America/Los_Angeles`, and the browser uses that timezone too.
- Rate limits stay switched on, exactly as in production.
