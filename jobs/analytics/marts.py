"""Load only verified raw manifests; dbt runs on a per-run candidate database."""
import argparse
import json
from pathlib import Path
from raw import read_batch
from events import canonical, digest, utc, now
from snapshots import snapshot


def load(manifests, database, max_age_seconds=86400):
    import duckdb
    if not 1 <= len(manifests) <= 1000:
        raise ValueError('Manifest bound exceeded')
    con = duckdb.connect(str(database))
    con.execute("SET memory_limit='256MB'")
    con.execute('SET threads=2')
    try:
        con.execute('BEGIN')
        con.execute('CREATE TABLE IF NOT EXISTS raw_events(event_id VARCHAR PRIMARY KEY, tenant_id VARCHAR, plant_id VARCHAR, aggregate_id VARCHAR, aggregate_version BIGINT, occurred_at VARCHAR, received_at VARCHAR, available_at VARCHAR, checksum VARCHAR, envelope VARCHAR)')
        total = 0
        chains, latest = {}, None
        for path in manifests:
            m, rows = read_batch(path)
            prior = chains.get(m['stream'])
            if (prior and (m['previous'] != prior['hash'] or m['start'] != prior['end'])) or (not prior and (m['start'] != 0 or m['previous'] is not None)):
                raise ValueError('Incomplete manifest chain')
            chains[m['stream']] = m
            for row in rows:
                e = snapshot(row['event']); checksum = digest(e)
                previous = con.execute('SELECT checksum FROM raw_events WHERE event_id=?', [e['eventId']]).fetchone()
                if previous and previous[0] != checksum:
                    raise ValueError('Replay corruption')
                if not previous:
                    con.execute('INSERT INTO raw_events VALUES (?,?,?,?,?,?,?,?,?,?)', [e['eventId'],e['tenantId'],e['plantId'],e['aggregateId'],e['aggregateVersion'],e['occurredAt'],row['receivedAt'],row['availableAt'],checksum,canonical(e)])
                latest = max(latest or utc(row['availableAt']), utc(row['availableAt']))
                total += 1
                if total > 1000000:
                    raise ValueError('Run exceeds one million events; partition backfill')
        if latest is None or (utc(now())-latest).total_seconds() > max_age_seconds:
            raise ValueError('Stale or empty dataset')
        con.execute('COMMIT')
        return {'rowsRead': total, 'heads': {s:m['hash'] for s,m in chains.items()}}
    except BaseException:
        con.execute('ROLLBACK')
        raise
    finally:
        con.close()


def parity(incremental, rebuild):
    import duckdb
    a, b = duckdb.connect(str(incremental), read_only=True), duckdb.connect(str(rebuild), read_only=True)
    try:
        def normalize(row):
            return canonical([v.isoformat() if hasattr(v,'isoformat') else str(v) if v is not None and not isinstance(v,(bool,int,str)) else v for v in row])
        for table in ('event_versions','resource_history','current_resources','order_balances'):
            left = sorted(normalize(row) for row in a.execute(f'SELECT * FROM {table}').fetchall())
            right = sorted(normalize(row) for row in b.execute(f'SELECT * FROM {table}').fetchall())
            if left != right:
                raise ValueError(f'Incremental/rebuild mismatch: {table}')
    finally:
        a.close(); b.close()


if __name__ == '__main__':
    p=argparse.ArgumentParser(); p.add_argument('database'); p.add_argument('manifests', nargs='+')
    args=p.parse_args(); print(json.dumps(load(args.manifests,args.database)))
