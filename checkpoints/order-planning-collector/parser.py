"""Validate bounded snapshot files; never interpret missing samples as zero."""
import hashlib
import json
from pathlib import Path
import statistics


def quantiles(values):
    values = sorted(values)
    if not values:
        return None
    return {'n': len(values), 'min': values[0], 'p50': statistics.median(values), 'p95': values[min(len(values)-1, int(len(values)*.95))], 'max': values[-1]}


def parse(directory):
    directory = Path(directory)
    owner = json.loads((directory/'owner.json').read_text())
    summary = json.loads((directory/'summary.json').read_text())
    if summary.get('schema') != 'IEMS_LOOPBACK_V1' or summary.get('reason') not in ('STOP_REQUEST','DURATION_LIMIT','SIZE_LIMIT','PARENT_EXIT','SIGNAL') or not 0 <= summary.get('durationMs',float('inf')) <= 121000 or summary.get('errors',1) != 0:
        raise ValueError('SUMMARY_ENDSTATE')
    if owner['schema'] != 'IEMS_LOOPBACK_V1' or owner['sessionToken'] != summary['sessionToken']:
        raise ValueError('SCHEMA_OR_OWNER_MISMATCH')
    with open(directory/'samples.ndjson','rb') as stream:
        raw=stream.read(8*1024*1024+1)
    if len(raw) > 8*1024*1024 or raw and not raw.endswith(b'\n'):
        raise ValueError('SIZE_OR_TRUNCATION')
    if not raw and summary['reason'] != 'SIZE_LIMIT':
        raise ValueError('EMPTY_SAMPLES')
    samples = [json.loads(line) for line in raw.splitlines()]
    last = -1
    for seq, row in enumerate(samples):
        if row['schema'] != owner['schema'] or row['seq'] != seq or row['monotonicNs'] <= last:
            raise ValueError('SEQUENCE_OR_CLOCK')
        last = row['monotonicNs']
        if len(row['tcp'].get('rows', [])) > 512:
            raise ValueError('ROW_LIMIT')
        for tcp in row['tcp'].get('rows', []):
            if not tcp['local'][0].startswith('127.') or not (tcp['remote'][0].startswith('127.') or tcp['remote'][0] == '0.0.0.0'):
                raise ValueError('REDACTION')
    if len(samples) != summary['samples'] or len(raw) != summary['bytes']:
        raise ValueError('SUMMARY_MISMATCH')
    return {'owner': owner, 'summary': summary, 'samples': samples, 'sampleCostMs': quantiles([s['sampleCostMs'] for s in samples]), 'sha256': hashlib.sha256(raw).hexdigest()}


if __name__ == '__main__':
    import argparse
    args = argparse.ArgumentParser(); args.add_argument('directory'); args = args.parse_args()
    result = parse(args.directory)
    result.pop('samples')
    print(json.dumps(result, indent=2))
