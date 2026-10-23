import hashlib
import json
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
manifest = json.loads((root / 'checkpoints/wave4h/SOURCE-MANIFEST.json').read_text())
errors = []
for name, digest in manifest.items():
    path = root / name
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        errors.append(f'manifest mismatch: {name}')
scopes = ['apps/portfolio-api', 'apps/web/test', 'apps/web/src/features/portfolio', 'packages/tenant-foundation', 'packages/customer-service', 'packages/document-rendering']
imports = []
for scope in scopes:
    for path in (root / scope).rglob('*'):
        if not path.is_file() or 'node_modules' in path.parts or path.suffix not in {'.js', '.mjs', '.jsx', '.ts'}:
            continue
        text = path.read_text()
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
