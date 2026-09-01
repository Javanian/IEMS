
CREATE TABLE IF NOT EXISTS public.mch_transaction_override (
    proddataid   bigint PRIMARY KEY,

    order_no     text,
    operation_no text,

    sn_employee  text,
    note         text,
    updated_by   text,
    updated_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT mch_transaction_override_something
      CHECK (order_no IS NOT NULL OR sn_employee IS NOT NULL)
);

COMMENT ON TABLE public.mch_transaction_override IS
  'Koreksi manual yang bertahan re-derivasi ETL. Diterapkan oleh etl_mch_transaction_v3 '
  '(apply_overrides) di atas hasil derivasi. Lihat migration 20260715_mch_transaction_override.';

