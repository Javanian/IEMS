"""Immutable Parquet batches. The manifest is the sole publication point."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4
from events import canonical, digest, now, utc, validate


def ingest(records, root, stream, start, end, previous=None):
    import duckdb
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    if not stream or len(stream) > 128 or type(start) is not int or type(end) is not int or not 0 <= start <= end:
        raise ValueError('Invalid source cursor')
    if previous:
        verify(previous)
        if previous['stream'] != stream or previous['end'] != start:
            raise ValueError('Cursor discontinuity')
    rows, rejected, seen = [], [], {}
    for index, record in enumerate(records):
        if index >= 10000:
            raise ValueError('Batch exceeds 10000 records')
        try:
            e = validate(record['event'])
            receipt, available = record['receivedAt'], record['availableAt']
            if not utc(e['occurredAt']) <= utc(receipt) <= utc(available):
                raise ValueError('Unavailable provenance')
            key, checksum = e['eventId'], digest(e)
            if key in seen:
                if seen[key] != checksum:
                    raise ValueError('Event identity corruption')
                continue
            seen[key] = checksum
            rows.append((key, e['tenantId'], e['plantId'], e['aggregateId'], e['aggregateVersion'], e['occurredAt'], receipt, available, checksum, canonical(e)))
        except (KeyError, TypeError, ValueError) as error:
            rejected.append({'index': index, 'reason': str(error), 'record': record})
    batch = str(uuid4())
    quarantine = root / f'{batch}.quarantine.json'
    if rejected:
        with quarantine.open('x', encoding='utf8') as f:
            f.write(canonical(rejected))
        raise ValueError(f'Batch quarantined: {quarantine.name}; cursor unchanged')
    target = root / f'{batch}.parquet'
    con = duckdb.connect(':memory:')
    try:
        con.execute("SET memory_limit='256MB'")
        con.execute('SET threads=2')
        con.execute('CREATE TABLE raw(event_id VARCHAR, tenant_id VARCHAR, plant_id VARCHAR, aggregate_id VARCHAR, aggregate_version BIGINT, occurred_at VARCHAR, received_at VARCHAR, available_at VARCHAR, checksum VARCHAR, envelope VARCHAR)')
        if rows:
            con.executemany('INSERT INTO raw VALUES (?,?,?,?,?,?,?,?,?,?)', rows)
        con.sql('SELECT * FROM raw ORDER BY event_id').write_parquet(str(target), compression='zstd')
    finally:
        con.close()
    manifest = {'version': 1, 'batchId': batch, 'stream': stream, 'start': start, 'end': end, 'previous': previous and previous['hash'], 'file': target.name, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'count': len(rows), 'eventsHash': digest(sorted(seen.items())), 'publishedAt': now()}
    manifest['hash'] = digest(manifest)
    tmp = root / f'{batch}.manifest.tmp'
    with tmp.open('x', encoding='utf8') as f:
        f.write(canonical(manifest)); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, root / f'{batch}.manifest.json')
    return manifest


def verify(manifest):
    body = {k: v for k, v in manifest.items() if k != 'hash'}
    if manifest.get('version') != 1 or digest(body) != manifest.get('hash'):
        raise ValueError('Invalid manifest')


def read_batch(path):
    import duckdb
    path = Path(path).resolve()
    manifest = json.loads(path.read_text(encoding='utf8'))
    verify(manifest)
    file = path.parent / manifest['file']
    if file.resolve().parent != path.parent or hashlib.sha256(file.read_bytes()).hexdigest() != manifest['sha256']:
        raise ValueError('Corrupt raw file')
    con = duckdb.connect(':memory:')
    try:
        rows = con.execute('SELECT envelope, checksum, received_at, available_at FROM read_parquet(?) ORDER BY event_id', [str(file)]).fetchall()
    finally:
        con.close()
    seen = []
    for envelope, checksum, receipt, available in rows:
        event = validate(json.loads(envelope))
        if digest(event) != checksum or not utc(event['occurredAt']) <= utc(receipt) <= utc(available):
            raise ValueError('Corrupt provenance')
        seen.append((event['eventId'], checksum))
    if len(rows) != manifest['count'] or digest(sorted(seen)) != manifest['eventsHash']:
        raise ValueError('Source sink reconciliation failed')
    return manifest, [{'event': json.loads(e), 'receivedAt': r, 'availableAt': a} for e, _, r, a in rows]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('input'); parser.add_argument('root'); parser.add_argument('--stream', required=True)
    parser.add_argument('--start', type=int, required=True); parser.add_argument('--end', type=int, required=True)
    parser.add_argument('--previous')
    args = parser.parse_args()
    previous = json.loads(Path(args.previous).read_text()) if args.previous else None
    with open(args.input, encoding='utf8') as source:
        print(canonical(ingest((json.loads(line) for line in source), args.root, args.stream, args.start, args.end, previous)))
