
UPDATE public.usernfc
   SET nfcid = NULL
 WHERE idrow = 16
   AND nfcid = '02:c0:52:69';

UPDATE public.usernfc SET nfcid = '3765072081' WHERE idrow =   1 AND nfcid = 'd1:70:6a:e0';
UPDATE public.usernfc SET nfcid = '2750541963' WHERE idrow =   2 AND nfcid = '8b:f0:f1:a3';
UPDATE public.usernfc SET nfcid = '1776006978' WHERE idrow =   3 AND nfcid = '42:b7:db:69';
UPDATE public.usernfc SET nfcid = '3766393889' WHERE idrow =   4 AND nfcid = '21:9c:7e:e0';
UPDATE public.usernfc SET nfcid = '3765862961' WHERE idrow =   5 AND nfcid = '31:82:76:e0';
UPDATE public.usernfc SET nfcid = '3766671361' WHERE idrow =   6 AND nfcid = '01:d8:82:e0';
UPDATE public.usernfc SET nfcid = '3765902849' WHERE idrow =   7 AND nfcid = '01:1e:77:e0';
UPDATE public.usernfc SET nfcid = '1775338402' WHERE idrow =  11 AND nfcid = 'a2:83:d1:69';
UPDATE public.usernfc SET nfcid =  '939770433' WHERE idrow =  51 AND nfcid = '41:c2:03:38';
UPDATE public.usernfc SET nfcid = '1765694418' WHERE idrow =  80 AND nfcid = 'd2:5b:3e:69';
UPDATE public.usernfc SET nfcid =  '939764033' WHERE idrow =  92 AND nfcid = '41:a9:03:38';
UPDATE public.usernfc SET nfcid = '1759782898' WHERE idrow = 271 AND nfcid = 'f2:27:e4:68';

DO $$
DECLARE
  n int;
  detail text;
BEGIN
  SELECT count(*), string_agg(nfcid || ' (' || owners || ')', '; ')
    INTO n, detail
    FROM (
      SELECT nfcid, string_agg(full_name, ' + ') AS owners
        FROM public.usernfc
       WHERE NULLIF(btrim(nfcid), '') IS NOT NULL
       GROUP BY nfcid
      HAVING count(*) > 1
    ) d;

  IF n > 0 THEN
    RAISE EXCEPTION 'Kartu ganda tersisa setelah normalisasi (% kartu): %', n, detail;
  END IF;
END $$;

