import hashlib
import json
import os
import subprocess
from pathlib import Path
from uuid import uuid4
from events import canonical, digest, now
from marts import load


def atomic_json(path, body):
    path = Path(path)
    temp = path.with_name(f'{path.name}.{uuid4()}.tmp')
    with temp.open('x', encoding='utf8') as f:
        f.write(canonical(body)); f.flush(); os.fsync(f.fileno())
    os.replace(temp, path)


def build(root, manifests, run_id, interval, project, profiles, max_age_seconds=86400):
    """A failed dbt build leaves diagnostics, never a trusted publication."""
    from re import fullmatch
    if not fullmatch(r'[A-Za-z0-9_.-]{1,160}', run_id):
        raise ValueError('Unsafe run id')
    root = Path(root).resolve(); root.mkdir(parents=True, exist_ok=True)
    publication = root / f'{run_id}.trusted.json'
    sources = [{'name': Path(p).name, 'sha256': hashlib.sha256(Path(p).read_bytes()).hexdigest()} for p in manifests]
    identity = digest({'sources': sources, 'interval': interval})
    if publication.exists():
        previous = json.loads(publication.read_text())
        if previous['inputHash'] != identity:
            raise ValueError('Run identity conflict')
        verify_publication(root, previous)
        return previous
    attempt = root / f'{run_id}.{uuid4()}'
    attempt.mkdir()
    database = attempt / 'candidate.duckdb'
    lineage = {'runId': run_id, 'attemptId': attempt.name, 'inputHash': identity, 'sources': sources, 'interval': interval, 'startedAt': now(), 'status': 'building'}
    atomic_json(attempt/'lineage.json', lineage)
    try:
        result = load(manifests, database, max_age_seconds)
        env = dict(os.environ, IEMS_ANALYTICS_DB=str(database))
        with (attempt/'dbt.log').open('w', encoding='utf8') as log:
            subprocess.run(['dbt','build','--project-dir',str(Path(project).resolve()),'--profiles-dir',str(Path(profiles).resolve()),'--target-path',str(attempt/'dbt-target'),'--log-path',str(attempt/'dbt-logs')], env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=600)
        results = json.loads((attempt/'dbt-target/run_results.json').read_text())
        if not results.get('results') or any(r['status'] not in ('success','pass') for r in results['results']):
            raise ValueError('Quality gate failed')
        lineage.update(status='trusted', completedAt=now(), result=result, database=str(database.relative_to(root)), sha256=hashlib.sha256(database.read_bytes()).hexdigest(), version=1)
        lineage['hash'] = digest(lineage)
        atomic_json(attempt/'lineage.json', lineage)
        # Orchestrator enforces one active run. Exclusive create detects conflicting retries.
        os.link(attempt/'lineage.json', publication)
        return lineage
    except BaseException as error:
        lineage.update(status='failed', completedAt=now(), errorType=type(error).__name__)
        atomic_json(attempt/'lineage.json', lineage)
        raise


def verify_publication(root, item):
    root = Path(root).resolve()
    path = (root/item['database']).resolve()
    if root not in path.parents or item.get('status') != 'trusted' or item.get('version') != 1:
        raise ValueError('Untrusted dataset')
    if digest({k:v for k,v in item.items() if k!='hash'}) != item.get('hash') or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
        raise ValueError('Publication checksum mismatch')
    return path
