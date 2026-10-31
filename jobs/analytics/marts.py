"""Load only verified raw manifests; dbt runs on a per-run candidate database."""
import argparse
import json
from pathlib import Path
from raw import read_batch
from events import canonical, digest, utc, now
from snapshots import snapshot


def load(manifests, database, max_age_seconds=86400, coverage_manifests=()):
    import duckdb
    if not 1 <= len(manifests) <= 1000:
        raise ValueError('Manifest bound exceeded')
    con = duckdb.connect(str(database))
    con.execute("SET memory_limit='256MB'")
    con.execute('SET threads=2')
    try:
        con.execute('BEGIN')
        con.execute('CREATE TABLE IF NOT EXISTS raw_events(event_id VARCHAR PRIMARY KEY, tenant_id VARCHAR, plant_id VARCHAR, aggregate_id VARCHAR, aggregate_version BIGINT, occurred_at VARCHAR, received_at VARCHAR, available_at VARCHAR, checksum VARCHAR, envelope VARCHAR)')
        con.execute('CREATE TABLE IF NOT EXISTS source_coverage(run_id VARCHAR PRIMARY KEY,tenant_id VARCHAR,plant_id VARCHAR,observed_at TIMESTAMPTZ,checksum VARCHAR,envelope JSON)')
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
        if len(coverage_manifests)>1000:
            raise ValueError('Coverage manifest bound exceeded')
        for path in coverage_manifests:
            path=Path(path)
            if path.stat().st_size>16*1024*1024:
                raise ValueError('Oversized source coverage')
            m=json.loads(path.read_text(encoding='utf-8-sig'))
            checksum=digest({k:v for k,v in m.items() if k!='hash'})
            if checksum!=m.get('hash') or m.get('coverage')!='COMPLETE' or m.get('trustedZero') is not True or m.get('quarantine')!=[] or m.get('unsupported')!=[] or m.get('fence')!='single-snapshot-transaction':
                raise ValueError('Untrusted source coverage')
            from uuid import UUID
            for key in ('tenantId','plantId','legalEntityId','runId'):
                UUID(m[key])
            if not 0<=(utc(now())-utc(m['observedAt'])).total_seconds()<=max_age_seconds:
                raise ValueError('Unavailable or stale source coverage')
            heads=m['snapshotHeads']
            if not isinstance(heads,list) or len(heads)>100000 or len({h['aggregateId'] for h in heads})!=len(heads):
                raise ValueError('Coverage identity conflict')
            for h in heads:
                row=con.execute('SELECT checksum FROM raw_events WHERE tenant_id=? AND plant_id=? AND aggregate_id=? AND aggregate_version=? AND event_id=?',[m['tenantId'],m['plantId'],h['aggregateId'],h['aggregateVersion'],h['eventId']]).fetchone()
                if not row or row[0]!=h['hash']:
                    raise ValueError('Coverage precedes immutable snapshot replay')
            prior=con.execute('SELECT checksum FROM source_coverage WHERE run_id=?',[m['runId']]).fetchone()
            if prior and prior[0]!=checksum:
                raise ValueError('Source coverage corruption')
            if not prior:
                con.execute('INSERT INTO source_coverage VALUES(?,?,?,?,?,?)',[m['runId'],m['tenantId'],m['plantId'],m['observedAt'],checksum,canonical(m)])
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
        for table in ('event_versions','resource_history','current_resources','order_quantities','order_quantity_balances','coverage_status','order_balances'):
            left = sorted(normalize(row) for row in a.execute(f'SELECT * FROM {table}').fetchall())
            right = sorted(normalize(row) for row in b.execute(f'SELECT * FROM {table}').fetchall())
            if left != right:
                raise ValueError(f'Incremental/rebuild mismatch: {table}')
    finally:
        a.close(); b.close()


if __name__ == '__main__':
    p=argparse.ArgumentParser(); p.add_argument('database'); p.add_argument('manifests', nargs='+')
    args=p.parse_args(); print(json.dumps(load(args.manifests,args.database)))
