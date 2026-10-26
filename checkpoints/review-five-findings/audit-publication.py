"""Check the published source set, relative imports, and whitespace without local dependencies."""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
manifest_path = Path(__file__).with_name('SOURCE-MANIFEST.json')
scopes = (
    'apps/portfolio-api/', 'apps/web/test/', 'apps/web/src/features/portfolio/',
    'apps/wa-demo-bridge/', 'packages/tenant-foundation/', 'packages/customer-service/',
    'packages/document-rendering/', 'packages/domain-test-fixtures/',
    'checkpoints/review-five-findings/',
    'checkpoints/company-stock-use/',
    'checkpoints/company-stock-trace/',
    'checkpoints/p2-f5a-dispatch-followup/',
    'checkpoints/wave4k/qa/', 'checkpoints/wave4k2a/qa/',
    'checkpoints/wave4k2b1/qa/', 'checkpoints/wave4k2b2a/qa/',
    'checkpoints/wave4map/qa/', 'checkpoints/wave4qc/qa/',
)
specific = {'.gitignore', '.github/workflows/portfolio-vat.yml', 'apps/web/package.json',
            'apps/web/package-lock.json', 'apps/web/vite.config.js', 'apps/web/src/index.css',
            'apps/web/src/router/index.jsx',
            'checkpoints/review-five-findings/audit-publication.py'}
# This unchanged renderer test uses a Windows path only as input to its pure quoting parser.
path_parser_fixture = {'packages/document-rendering/test/wave3b-recovery.test.mjs':
                       'f96a744b187d6d7488e73e0fa23fea8ef08f8b038bd959d2e5301f57dcff753b'}

def digest(path):
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()

def git_names(*args):
    return subprocess.check_output(['git', '-C', str(root), *args, '-z']).decode().split('\0')

tracked = set(git_names('ls-files')) - {''}
if '--write' in sys.argv:
    candidates = tracked | (set(git_names('ls-files', '--others', '--exclude-standard')) - {''})
    names = sorted(name for name in candidates if name != manifest_path.relative_to(root).as_posix() and (name in specific or name.startswith(scopes)) and (root / name).is_file())
    manifest_path.write_text(json.dumps({name: digest(root / name) for name in names}, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {len(names)} source hashes; rerun without --write after staging/commit.')
    raise SystemExit(0)

manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
errors = []
imports = 0
for name, expected in manifest.items():
    path = root / name
    if name not in tracked:
        errors.append(f'unpublished source: {name}')
    if not path.is_file() or digest(path) != expected:
        errors.append(f'manifest mismatch: {name}')
        continue
    if path.suffix not in {'.js', '.mjs', '.jsx', '.ts'}:
        continue
    source = path.read_text(encoding='utf-8')
    for specifier in re.findall(r'''(?:from\s+|import\s+|(?:import|require)\s*\()['"]([^'"]+)''', source):
        if not specifier.startswith('.') or 'node_modules' in specifier:
            continue
        target = (path.parent / specifier).resolve()
        choices = [target, Path(str(target) + '.js'), Path(str(target) + '.jsx'), target / 'index.js', target / 'index.jsx']
        imports += 1
        if not any(choice.is_file() and choice.relative_to(root).as_posix() in tracked for choice in choices):
            errors.append(f'unpublished import: {name} -> {specifier}')
    if re.search(r'(?:file:///)?[CD]:[/\\](?:Users|Project AI)', source) and path_parser_fixture.get(name) != digest(path):
        errors.append(f'local dependency: {name}')
whitespace = subprocess.run(['git', '-C', str(root), 'diff', '--check', 'HEAD'], capture_output=True, text=True)
if whitespace.returncode:
    errors.append(whitespace.stdout + whitespace.stderr)
print(json.dumps({'manifestFiles': len(manifest), 'relativeImportEdges': imports, 'errors': errors}, indent=2))
raise SystemExit(bool(errors))
