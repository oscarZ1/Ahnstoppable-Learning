# Database backups

A GitHub Actions workflow (`.github/workflows/db-backup.yml`) backs up the
production database every day at 3 AM Pacific. Each backup is encrypted, then
kept for 30 days under the repository's **Actions** tab.

The repository is public, so backups are only safe because they're encrypted.
Never commit a decrypted `.dump` file, and never share the passphrase in an
issue, pull request, or commit.

## One-time setup

1. Create a long random passphrase, for example with `openssl rand -base64 32`.
   Store it in a password manager the department controls. **Without it, the
   backups can't be restored.**
2. In GitHub, open **Settings > Secrets and variables > Actions** and add:
   - `SUPABASE_DB_URL`: the Supabase **Session pooler** connection string
     (Project > Connect), with the database password filled in.
   - `BACKUP_PASSPHRASE`: the passphrase from step 1.
3. Merge the workflow into `main`. GitHub only runs scheduled workflows from
   the default branch.
4. Open **Actions > Database backup > Run workflow** to take a first backup
   and confirm it succeeds.

If a run fails, GitHub emails the people watching the repository's Actions.

## Restoring a backup

1. In **Actions > Database backup**, open a successful run and download the
   artifact. GitHub delivers it as a `.zip`; unzip it to get the `.dump.enc`.
2. Decrypt it. You'll be asked for the passphrase.

   ```
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
     -in ahnstoppable-2026-10-03T1000Z.dump.enc -out backup.dump
   ```

3. Restore into a database. To check a backup safely, restore into a new local
   database first:

   ```
   createdb ahnstoppable_restore
   pg_restore --no-owner --no-privileges --dbname=ahnstoppable_restore backup.dump
   ```

   To replace production after data loss, restore into Supabase with
   `--clean --if-exists`, which drops and recreates the app's tables first.
   This overwrites everything since the backup, so stop the backend on
   Railway before running it and restart it afterwards.

   ```
   PGSSLMODE=require pg_restore --clean --if-exists --no-owner --no-privileges \
     --dbname="<Supabase session pooler string>" backup.dump
   ```

   If the target database runs Postgres older than 17, `pg_restore` reports
   one ignored error about `transaction_timeout`. That's harmless: it's a
   setting older servers don't recognize.

4. Delete the decrypted `backup.dump` when you're done.

`pg_restore` must be version 17 or newer. On a Mac: `brew install postgresql@17`.
