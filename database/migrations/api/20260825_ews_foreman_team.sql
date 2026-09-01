-- 20260825_ews_foreman_team.sql
-- Kelola bawahan foreman: foreman = akun WEB (public.users, role foreman);
-- member = operator NFC (usernfc.snssb). 1 operator = 1 foreman
-- (member_serialnumber UNIQUE; pindah = DELETE lama + INSERT baru).

CREATE TABLE IF NOT EXISTS ews.foreman_team (
  id bigserial PRIMARY KEY,
  foreman_user_id integer NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  member_serialnumber text NOT NULL UNIQUE,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_foreman_team_user ON ews.foreman_team (foreman_user_id);
