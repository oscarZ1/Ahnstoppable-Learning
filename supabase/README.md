# Database schema (Supabase)

`supabase/migrations` is the only source of the database schema. Each file runs
once, in name order.

| Where | What applies the migrations |
| --- | --- |
| Production (Supabase) | GitHub Actions, `.github/workflows/supabase-migrations.yml`, on every push to `main` that changes `supabase/migrations/**` (or by hand: Actions → "Supabase migrations" → Run workflow). Runs `supabase db push`, which records applied files in `supabase_migrations.schema_migrations`. |
| Local dev and e2e tests | `cd backend && npm run migrate` (`backend/scripts/migrate.js`), which records applied files in `public.schema_migrations`. |

Railway does **not** migrate the database any more.

## The files

- `20261109000000_baseline.sql`: the full schema as of 2026-11-09. On an empty
  database it creates all 22 tables. On a database built by the old runner
  (`backend/migrations-legacy`, e.g. production) it only adds what's missing and
  never deletes data. Every statement is idempotent, and CI runs it twice to
  prove that.
- `20261109000100_enable_rls.sql`: turns on Row Level Security for every table
  in `public`, with no policies. Supabase publishes `public` through its REST
  API; without RLS anyone with the project's anon key could read `users`
  (password hashes included) or write to any table. The backend connects as
  `postgres`, which owns the tables, so RLS doesn't affect it.

## What CI does

- **Pull requests** (and pushes to `main`): the `validate` job applies every
  migration to an empty Postgres 17 with `supabase db push`, then runs the
  baseline again to check it's still idempotent.
- **Push to `main`** (or a manual run): after `validate` passes, the `deploy`
  job runs `supabase db push --dry-run` (the log lists exactly which files will
  run), then `supabase db push --yes` against production.

The workflow pins the Supabase CLI to 3.1.0 and passes the database as
`--remote=<url>` (`--db-url` is deprecated). `--yes` is required because CI
can't answer the CLI's "apply N migrations?" prompt. When you bump the CLI
version, check the release notes for changes to `db push`.

## One-time setup

1. **Rotate the Supabase database password** (it was exposed and never
   rotated): Supabase → Project Settings → Database → Reset database password.
   Then update `DATABASE_URL` on Railway (backend service → Variables).
2. **GitHub → repo Settings → Secrets and variables → Actions:** set
   `SUPABASE_DB_URL` to the **Session pooler** connection string (port 5432,
   not the 6543 transaction pooler), with the new password. The daily backup
   workflow uses the same secret.
   Optional but recommended: Settings → Environments → New environment
   `production` → "Required reviewers" = you. Deploys then wait for your
   approval.
3. **Railway → backend service → Settings → Deploy:** clear the
   **Pre-deploy command** (`npm run migrate`).
4. **First production run:**
   1. Actions → "Database backup" → Run workflow, and wait for it to succeed.
   2. Actions → "Supabase migrations" → Run workflow (branch `main`). Check the
      dry-run step lists the baseline and RLS files, then let it apply (approve
      it if you set up the `production` environment).
   3. Check: Supabase Table Editor shows all 22 tables;
      `select * from supabase_migrations.schema_migrations` lists both files;
      Railway `/health` returns `ok`; a student can post a comment and a reply
      on the live site; Supabase's Security Advisor no longer flags RLS.

## Changing the schema from now on

1. Add `supabase/migrations/<YYYYMMDDHHMMSS>_short_name.sql` (UTC timestamp,
   later than every existing file), e.g. `20261201153000_add_poll_notes.sql`.
   - Make it idempotent when you can (`IF NOT EXISTS`, `ADD COLUMN IF NOT
     EXISTS`, …).
   - Don't add `BEGIN`/`COMMIT`; each file already runs in one transaction.
   - **Enable RLS on any new table:** `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;`
   - Never edit a migration that has already reached `main`; add a new one.
2. Apply it locally: `cd backend && npm run migrate`, then run the e2e tests
   (`cd e2e && npm test`), which build their database with the same files.
3. Open a pull request. CI checks that all migrations apply to an empty
   database.
4. Merge to `main`. CI applies the new file to production.
