-- Turn on Row Level Security for every table in the public schema.
--
-- Supabase publishes the public schema through its REST API (PostgREST).
-- Without RLS, anyone holding the project's anon key could read users
-- (including password hashes) or write to any table. No policies are added,
-- so the API gets nothing.
--
-- The backend is unaffected: it connects as postgres, which owns these tables,
-- and table owners bypass RLS (it is not FORCEd).
--
-- Any table added by a later migration needs its own
--   ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
