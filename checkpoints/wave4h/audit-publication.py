import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description='Audit source hashes and relative imports; --write regenerates hashes without removing existing coverage.')
parser.add_argument('--write', action='store_true')
args = parser.parse_args()
manifest_path = root / 'checkpoints/wave4h/SOURCE-MANIFEST.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
automation_paths = set()
for scope in ['ops/automation-lab', 'checkpoints/n8n-automation']:
    for path in (root / scope).rglob('*'):
        if path.is_file() and not {'node_modules', '.n8n', 'data', 'logs'}.intersection(path.parts) and path.suffix in {'.mjs', '.js', '.cjs', '.json', '.ps1', '.md', '.example', '.cmd', '.bat'}:
            automation_paths.add(path.relative_to(root).as_posix())
for scope in ['apps/portfolio-api/src', 'apps/portfolio-api/test', 'apps/web/test', 'apps/web/src/features/portfolio']:
    for path in (root / scope).rglob('*automation*'):
        if path.is_file():
            automation_paths.add(path.relative_to(root).as_posix())
automation_paths.add('apps/web/src/features/portfolio/AutomationCenterWorkspace.jsx')
digest_of = lambda path: hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
if args.write:
    names = sorted(set(manifest) | automation_paths)
    missing = [name for name in names if not (root / name).is_file()]
    if missing:
        raise SystemExit(f'Refusing to remove manifest coverage; missing files: {missing}')
    manifest = {name: digest_of(root / name) for name in names}
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
errors = []
for name in sorted(automation_paths - set(manifest)):
    errors.append(f'missing automation manifest coverage: {name}')
for name, digest in manifest.items():
    path = root / name
    if not path.is_file() or digest_of(path) != digest:
        errors.append(f'manifest mismatch: {name}')
scopes = ['apps/portfolio-api', 'apps/web/test', 'apps/web/src/features/portfolio', 'packages/tenant-foundation', 'packages/customer-service', 'packages/document-rendering', 'ops/automation-lab']
imports = []
for scope in scopes:
    for path in (root / scope).rglob('*'):
        if not path.is_file() or 'node_modules' in path.parts or path.suffix not in {'.js', '.mjs', '.jsx', '.ts'}:
            continue
        text = path.read_text(encoding='utf-8')
        for specifier in re.findall(r'''(?:from\s+|import\s*\()['"]([^'"]+)''', text):
            if not specifier.startswith('.') or 'node_modules' in specifier:
                continue
            target = path.parent / specifier
            candidates = [target, Path(str(target) + '.jsx'), Path(str(target) + '.js'), target / 'index.jsx', target / 'index.js']
            imports.append([path.relative_to(root).as_posix(), specifier])
            if not any(candidate.exists() for candidate in candidates):
                errors.append(f'missing import: {imports[-1]}')
        if 'file:///D:' in text or 'packages/mongodb-spike' in text or 'ops/job13' in text:
            errors.append(f'unpublished local dependency: {path.relative_to(root)}')
result = subprocess.run(['git', '-C', str(root), 'diff', '--check'], capture_output=True, text=True)
if result.returncode:
    errors.append(result.stdout + result.stderr)
print(json.dumps({'manifestFiles': len(manifest), 'relativeImportEdges': len(imports), 'diffCheck': result.returncode, 'errors': errors}, indent=2))
raise SystemExit(bool(errors))
