"""Positive publication and adversarial native dbt gates in a NEW evidence directory."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

from events import canonical, digest, now
from publish import build, verify_publication
from raw import ingest, read_batch


def run(completed, new_root):
    completed, root = Path(completed).resolve(), Path(new_root).resolve()
    assert (completed / 'result.json').is_file() and not root.exists()
    root.mkdir()
    manifests = [p for p in (completed / 'raw').glob('*.manifest.json') if p.name != 'corrupt.manifest.json']
    manifests.sort(key=lambda p: json.loads(p.read_text())['start'])
    coverage = [completed / 'initial.coverage.json', completed / 'corrected.coverage.json']
    project = Path(__file__).resolve().parents[2] / 'analytics/dbt'
    profiles = completed / 'profiles'
    valid = build(root / 'positive', manifests, 'valid', 'synthetic', project, profiles, coverage_manifests=coverage)
    verify_publication(root / 'positive', valid)

    def failure(label, paths, coverage_paths):
        target = root / label
        try:
            build(target, paths, label, 'synthetic', project, profiles, coverage_manifests=coverage_paths)
        except subprocess.CalledProcessError:
            pass
        else:
            raise AssertionError('Native dbt accepted ' + label)
        assert not list(target.glob('*.trusted.json'))
        results = list(target.glob('*/dbt-target/run_results.json'))
        assert len(results) == 1
        failed = [r['unique_id'] for r in json.loads(results[0].read_text())['results'] if r['status'] == 'fail']
        assert any(label in name for name in failed), failed
        return failed

    failures = {'coverage_complete': failure('coverage_complete', manifests, [])}
    _, records = read_batch(manifests[0])
    records = deepcopy(records)
    order = next(r for r in records if r['event']['payload']['resourceType'] == 'order')
    order['event']['payload']['amount'] = '1.00'
    raw = root / 'bad-balance-raw'
    batch = ingest(records, raw, 'iems.reporting.snapshots.v2:synthetic-balance', 0, len(records))
    first = records[0]['event']
    m = {'runId': str(uuid4()), 'tenantId': first['tenantId'], 'plantId': first['plantId'],
         'legalEntityId': first['payload']['legalEntityId'], 'observedAt': now(), 'coverage': 'COMPLETE',
         'trustedZero': True, 'quarantine': [], 'unsupported': [], 'fence': 'single-snapshot-transaction',
         'snapshotHeads': [{'aggregateId': r['event']['aggregateId'], 'aggregateVersion': r['event']['aggregateVersion'],
                            'eventId': r['event']['eventId'], 'hash': digest(r['event'])} for r in records]}
    m['hash'] = digest(m)
    path = root / 'bad-balance.coverage.json'
    path.write_text(canonical(m))
    failures['balances'] = failure('balances', [raw / (batch['batchId'] + '.manifest.json')], [path])
    result = {'validPublication': 'PASS', 'failedBuildsNeverPublish': 'PASS', 'nativeFailures': failures}
    (root / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == '__main__':
    run(*sys.argv[1:])
