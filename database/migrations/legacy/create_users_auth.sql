CREATE TABLE IF NOT EXISTS public.users (
  id serial PRIMARY KEY,
  username varchar(100) NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  name varchar(150) NOT NULL,
  role varchar(50) NOT NULL DEFAULT 'user',
  roles varchar(50),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS roles varchar(50);

INSERT INTO public.users (username, password_hash, name, role, roles, created_at, updated_at)
VALUES (
  'admin',
  'sha256$5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5',
  'Tee San',
  'administrator',
  'administrator',
  now(),
  now()
)
ON CONFLICT (username) DO UPDATE
SET
  password_hash = EXCLUDED.password_hash,
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  roles = EXCLUDED.roles,
  updated_at = now();
