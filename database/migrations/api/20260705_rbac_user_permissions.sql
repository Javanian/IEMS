
CREATE SCHEMA IF NOT EXISTS rbac;

CREATE TABLE IF NOT EXISTS rbac.user_permissions (
  user_id     integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  feature_id  text    NOT NULL,
  level       text    NOT NULL CHECK (level IN ('no_access','read_only','full_access')),
  updated_by  integer,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_rbac_user_permissions_user ON rbac.user_permissions(user_id);

