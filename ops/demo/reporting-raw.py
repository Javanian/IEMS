"""Synthetic private composition of the existing raw Parquet API."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'jobs' / 'analytics'))
from raw import ingest, read_batch
from events import now, digest


def commit(root, marker, database, event):
    root = Path(root).resolve()
    owner = json.loads((root / 'reporting-owner.json').read_text())
    if owner != {'schema': 'IEMS_REPORTING_SYNTHETIC_V1', 'marker': marker, 'databaseName': database}:
        raise ValueError('Extraction ownership mismatch')
    pointer = root / 'reporting-raw-current.json'
    previous = None
    if pointer.exists():
        name = json.loads(pointer.read_text())['manifest']
        if Path(name).name != name:
            raise ValueError('Invalid raw pointer')
        previous, _ = read_batch(root / name)
        prior = previous.get('snapshotReceipts', {}).get(event['eventId'])
        if prior:
            if prior != digest(event):
                raise ValueError('Raw replay corruption')
            return
    start = previous['end'] if previous else 0
    receipt = now()
    manifest = ingest([{'event': event, 'receivedAt': receipt, 'availableAt': receipt}], root,
                      'iems.reporting.snapshots.v2:local:' + database, start, start + 1, previous)
    temp = root / (manifest['batchId'] + '.reporting-pointer-partial')
    with temp.open('x', encoding='utf8') as handle:
        handle.write(json.dumps({'manifest': manifest['batchId'] + '.manifest.json'}))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, pointer)


if __name__ == '__main__':
    value = sys.stdin.buffer.read(1024 * 1024 + 1)
    if len(value) > 1024 * 1024:
        raise ValueError('Snapshot too large')
    commit(*sys.argv[1:4], json.loads(value))
