SELECT
    DATE(mp.startdatetime) AS production_date,
    mp.machineno,
    mm.machinename AS machinename,

    SUM(CASE
        WHEN mp.jobid LIKE 'n%'
          OR mp.jobid LIKE '8%'
          OR mp.jobid LIKE 'M%'
        THEN 1 ELSE 0
    END) AS anomaly_count,

    SUM(CASE
        WHEN mp.jobid LIKE '1%'
          OR mp.jobid LIKE '6%'
          OR mp.jobid LIKE '7%'
        THEN 1 ELSE 0
    END) AS valid_count,

    COUNT(*) AS total_count,

    ROUND(
        100.0 * SUM(CASE
            WHEN mp.jobid LIKE '1%'
              OR mp.jobid LIKE '6%'
              OR mp.jobid LIKE '7%'
            THEN 1 ELSE 0
        END) / NULLIF(COUNT(*), 0),
        2
    ) AS accuracy_pct

FROM mch_productiondata mp
LEFT JOIN mch_machines mm
    ON mp.machineno = mm.machineno
WHERE
    mp.jobid LIKE 'n%'
    OR mp.jobid LIKE '8%'
    OR mp.jobid LIKE 'M%'
    OR mp.jobid LIKE '1%'
    OR mp.jobid LIKE '6%'
    OR mp.jobid LIKE '7%'
GROUP BY
    DATE(mp.startdatetime),
    mp.machineno,
    mm.machinename
ORDER BY
    production_date DESC,
    mp.machineno;