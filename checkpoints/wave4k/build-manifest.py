import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
target = root / 'checkpoints/wave4k/SOURCE-MANIFEST.json'
paths = set(json.loads((root / 'checkpoints/wave4j/SOURCE-MANIFEST.json').read_text(encoding='utf-8')))
for args in (['diff', '--name-only', '4b9eab05355558c0599fe4d054d16b076e8d88d7'], ['ls-files', '--others', '--exclude-standard']):
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True, check=True)
    paths.update(result.stdout.splitlines())
paths.add('packages/domain-test-fixtures/src/scenarios/e01ManufacturingTenUnits.js')
paths.discard(target.relative_to(root).as_posix())
manifest = {name: hashlib.sha256((root / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
            for name in sorted(paths) if (root / name).is_file()}
target.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'manifestFiles': len(manifest), 'path': str(target)}))
