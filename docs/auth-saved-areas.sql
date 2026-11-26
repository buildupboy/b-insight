-- Additive migration. Run with npm run migrate:auth or the Supabase SQL editor.
BEGIN;
CREATE TABLE IF NOT EXISTS public.binsight_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9]{1,40}$'),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.binsight_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.binsight_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS binsight_sessions_user_idx ON public.binsight_sessions(user_id);
CREATE INDEX IF NOT EXISTS binsight_sessions_expiry_idx ON public.binsight_sessions(expires_at);
CREATE TABLE IF NOT EXISTS public.saved_commercial_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.binsight_users(id) ON DELETE CASCADE,
  area_id text NOT NULL,
  area_name text NOT NULL,
  district_name text NOT NULL,
  industry_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, area_id)
);
CREATE INDEX IF NOT EXISTS saved_commercial_areas_recent_idx ON public.saved_commercial_areas(user_id, created_at DESC);
ALTER TABLE public.binsight_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.binsight_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_commercial_areas ENABLE ROW LEVEL SECURITY;
-- Custom sessions are verified by the Node backend. Never grant client access.
REVOKE ALL ON public.binsight_users, public.binsight_sessions, public.saved_commercial_areas FROM anon, authenticated;
COMMIT;
