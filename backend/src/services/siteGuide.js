// src/services/siteGuide.js
// How the website works. SITE_GUIDE (the student's point of view) is sent with
// every assistant prompt (services/studyAssistant.js) so the corner assistant
// can answer "how do I…" questions about the site; professors also get
// PROFESSOR_GUIDE. Keep both in step with the real features: when a feature
// changes, update this text.

export const SITE_GUIDE = `## How this website works (for students)

Signing in
- Pick your class and your name on the sign-in page, then type your password.
- The first time (or after your professor resets your password) you create a password instead. Forgot it? Only your professor can reset it, from the class roster; there is no email reset.
- The Home page lists your classes. Click one to open its class page.

The class page and its days
- Everything on the class page belongs to one day. Use the arrows, the calendar button, or "Today" above the cards to move between days. Days with activity are marked in the calendar.
- Students can look at today and past days, never future days. Things the professor prepares ahead appear when the professor starts them on their day.

Understanding Check
- During class the professor may start a check, sometimes with a label such as a slide or topic.
- Pick 👎, 👋 or 👍 for how well you follow. You can change your pick until the professor ends the check.
- Students see the results once the check has ended. Your professor sees who picked what.

Polls
- The professor opens a poll with 2 to 6 answers. Pick one; you can change it until the poll closes.
- Students see the bars and counts after the poll closes, never who voted for what. Your professor sees the names.
- Some polls have a correct answer. Once the poll closes, it's marked "Correct" and you're told whether your pick was right. Opinion polls have no correct answer.

Questions card
- Ask a question at any time (up to 300 characters). Classmates see it as anonymous; your professor sees your name and may write an answer.
- You can edit or delete your own questions. Give a thumbs up to questions and answers you find useful.
- Once the professor has answered, anyone can reply under the answer (up to 1,000 characters). Replies follow the same anonymity rules.
- "Summarize questions" at the top of the card gives an AI overview of the day's questions: the main themes and what people seem confused about. It never shows names. If questions were added, edited or deleted since, press it again to update it.

Discussion posts, comments and replies
- The professor posts discussions for a day. Comment on a post, or reply to a comment or to another reply (up to 1,000 characters each).
- Classmates see your comments and replies as "Anonymous"; your own show as "You". Your professor always sees names.
- You can edit or delete your own comments and replies, and like other people's. The professor can delete anything in the class.
- Posting limits stop spam: about 5 questions a minute (30 an hour), and 6 comments or replies a minute (60 an hour). If you hit one, wait a minute and try again.

Talent points
- You earn one talent point for each question, comment or reply you post. Deleting the post (or the professor deleting it) takes that point back.
- The Talent board on the class page ranks the class by points.

This assistant
- The assistant button in the bottom-right corner opens a private chat with an AI assistant (Google's Gemini 3.5 Flash-Lite). You can ask it anything. It also knows how this website works and, when your professor has turned on course help for a class, that class's posted material.
- Your chat is private: your professor only sees an anonymous summary of the topics students ask about. Chats are deleted automatically after a while.
- If you have your own Google Gemini API key (from Google AI Studio), you can add it under the gear in the assistant. The assistant then answers with your account, using the same model and rules. A Gemini app subscription is not an API key and can't be used here.
- The assistant can make mistakes. For grades, deadlines and anything graded, ask your professor.`;

export const PROFESSOR_GUIDE = `## How this website works (for professors)

Accounts and classes
- Professors register with an email and password on the Register page, and sign in with "Sign in with email". Students don't register.
- Create a class from the Home page. A professor who teaches several classes can jump between them with the class menu at the top of a class page.

Roster and student sign-in
- Students get into a class through its roster: add their names (paste a class list, one per line, as "Last, First"). Students then sign in by picking the class and their name.
- If a student forgets their password, use "Reset password" next to their name in the roster; they create a new one the next time they sign in.

Days and planning
- The class page shows one day at a time. Professors can also open future days to plan ahead: discussion posts for a future day appear to students when that day arrives, and polls or understanding checks prepared on a future day stay hidden until you click Start on that day.

Running class
- Discussion: create a discussion post for the day you're viewing. Students comment and reply; you see their names, classmates see "Anonymous".
- Polls: write a question with 2 to 6 answers and open it; one poll can be open at a time. You see live bars with who picked what; students see counts only after you close it. To make it a quiz question, mark the correct answer with the ✓ button next to it, or pick it later from the "Correct answer" menu under the poll (also on past polls); students only see it once the poll is closed, along with whether they got it right. Leave it unmarked for an opinion poll.
- Understanding checks: start a round (optionally labelled), students pick 👎 👋 👍, and you see live counts; end it to show students the result. One check can run at a time.
- Questions: answer students' questions (you can edit or remove an answer), and delete questions that shouldn't be there. "Summarize questions" makes an AI overview of the day's questions; you also get "Ideas for next class", which students don't see.
- The "Student names" switch shows or hides names on your screen (handy when projecting). "View as student" shows the page exactly as students see it; nothing you do there is sent.

Results
- The Results page (📋 Results) lists every poll and understanding check across all days, with who answered what (and, for polls with a correct answer, how many got it right), and downloads each student's answers as a CSV with a "Correct?" column (for example for participation or quiz grades).

Study assistant settings
- Course help settings are in the corner assistant: open it on (or pick) a class you teach and click the sliders button next to the gear. There you turn course help on or off for students, and takes your instructions (which the assistant follows first, for example "don't solve the weekly problem sets") and course notes. It also shows an anonymous AI summary of what students asked the assistant on a day.
- You can use the assistant yourself from the corner button on any page, including in your own classes whether or not course help is on for students. Your messages are never part of the students' summary.`;
