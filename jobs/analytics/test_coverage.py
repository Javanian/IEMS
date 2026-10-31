"""Execute the coverage model on the pinned native DuckDB, including missing heads."""
import json
from pathlib import Path
import unittest

import duckdb


class Coverage(unittest.TestCase):
    def test_native_coverage(self):
        sql = (Path(__file__).resolve().parents[2] / 'analytics/dbt/models/coverage_status.sql').read_text()
        sql = sql.replace("{{ source('raw','source_coverage') }}", 'source_coverage').replace("{{ ref('event_versions') }}", 'event_versions')
        with duckdb.connect() as con:
            con.execute('CREATE TABLE source_coverage(tenant_id VARCHAR,plant_id VARCHAR,run_id VARCHAR,observed_at TIMESTAMP,envelope JSON)')
            con.execute('CREATE TABLE event_versions(tenant_id VARCHAR,plant_id VARCHAR,aggregate_id VARCHAR,aggregate_version BIGINT,checksum VARCHAR,event_id VARCHAR)')
            con.execute("INSERT INTO event_versions VALUES ('t','p','a',1,'hash','event'),('other','p','b',1,'other','other-event')")

            def check(heads, expected):
                con.execute('DELETE FROM source_coverage')
                con.execute("INSERT INTO source_coverage VALUES ('t','p','run',now(),?)", [json.dumps({'snapshotHeads': heads})])
                self.assertEqual(con.execute(sql).fetchone()[3], expected)

            head = {'aggregateId': 'a', 'aggregateVersion': 1, 'hash': 'hash'}
            check([head], True)
            for field, value in [('aggregateId', 'missing'), ('aggregateVersion', 2), ('hash', 'corrupt')]:
                with self.subTest(field=field):
                    check([{**head, field: value}], False)
            check([], False)
            check([head, head], False)
            check([{'aggregateId': 'b', 'aggregateVersion': 1, 'hash': 'other'}], False)
            con.execute("INSERT INTO event_versions VALUES ('t','p','a',2,'new-hash','new-event')")
            check([head], False)
            check([{**head, 'aggregateVersion': 2, 'hash': 'new-hash'}], True)
            con.execute("INSERT INTO source_coverage VALUES ('t','p','old',timestamp '2000-01-01',?)", [json.dumps({'snapshotHeads': []})])
            self.assertEqual(con.execute(sql).fetchall()[0][3], True)
            con.execute('DELETE FROM event_versions')
            check([], True)


if __name__ == '__main__':
    unittest.main()
