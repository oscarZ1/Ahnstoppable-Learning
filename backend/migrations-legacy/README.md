# Legacy migrations (history only, not applied)

These are the migrations `backend/scripts/migrate.js` used to apply (001–011),
plus the `schema.sql` it used to build an empty database. They are kept only to
show how the schema got where it is.

**Nothing here runs any more.** The schema now lives in `supabase/migrations`.
Its first file, `20261109000000_baseline.sql`, brings both empty databases and
databases built from these files to the same shape, without deleting data. See
`supabase/README.md`.

Don't edit or add files here.
