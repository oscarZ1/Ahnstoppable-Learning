# Ahnstoppable-Learning
Discussion Board App for Class

## Database schema

The schema lives in [`supabase/migrations`](supabase/README.md). GitHub Actions
applies new migrations to production (Supabase) when they're merged to `main`;
locally, `cd backend && npm run migrate` applies them. See
[`supabase/README.md`](supabase/README.md) for how to change the schema.

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
