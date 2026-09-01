
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS ews.operator_shift_lock (
  id             bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  serialnumber   text    NOT NULL,
  locked_shift   text    NOT NULL REFERENCES ews.operator_shift(shift_code),
  effective_from date    NOT NULL,
  lock_weeks     integer NOT NULL CHECK (lock_weeks > 0),
  lock_end       date    NOT NULL,
  created_by     text    NOT NULL,
  cancelled_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT operator_shift_lock_end_after_start CHECK (lock_end > effective_from),

  CONSTRAINT operator_shift_lock_no_overlap
    EXCLUDE USING gist (
      serialnumber                                WITH =,
      daterange(effective_from, lock_end, '[)')   WITH &&
    ) WHERE (cancelled_at IS NULL)
);

