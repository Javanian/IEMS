import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = process.env.PAPERCLIP_RUN_SCRATCH_DIR || process.env.PAPERCLIP_SCRATCH_DIR;
if (!scratch) throw new Error('PAPERCLIP_RUN_SCRATCH_DIR required');
const result = { mode: 'OFFLINE_MOCK_ONLY', checks: [], status: 'NOT_RUN' };
const env = { ...process.env, CHECKPOINT_DISABLE: '1', TF_IN_AUTOMATION: '1', TF_INPUT: '0', AWS_EC2_METADATA_DISABLED: 'true', AWS_ACCESS_KEY_ID: 'offline-mock-only', AWS_SECRET_ACCESS_KEY: 'offline-mock-only', AWS_SESSION_TOKEN: '' };
for (const key of Object.keys(env)) if (key.startsWith('TF_CLI_ARGS') || key.startsWith('TF_VAR_')) delete env[key];
const run = args => {
  const proc = spawnSync('terraform', args, { cwd: target, encoding: 'utf8', timeout: 120000, windowsHide: true, env });
  result.checks.push({ command: ['terraform', ...args], cwd: target, exit: proc.status, error: proc.error?.code, stdout: proc.stdout, stderr: proc.stderr });
  return !proc.error && proc.status === 0;
};
const target = join(resolve(scratch), `terraform-aws-${Date.now()}`), config = `${target}.tfrc`;
env.TF_CLI_CONFIG_FILE = config;
env.TF_DATA_DIR = join(target, '.terraform');
env.TF_WORKSPACE = 'default';
mkdirSync(target, { recursive: true });
cpSync(join(root, 'infra/terraform/aws'), target, { recursive: true });
const mirror = process.env.PLATFORM_TF_PROVIDER_MIRROR;
writeFileSync(config, `provider_installation {\n filesystem_mirror {\n path = ${JSON.stringify(resolve(mirror || target).replaceAll('\\', '/'))}\n include = ["registry.terraform.io/hashicorp/aws"]\n }\n}\ndisable_checkpoint = true\n`);
const cli = spawnSync('terraform', ['version', '-json'], { encoding: 'utf8', timeout: 10000, windowsHide: true, env });
if (cli.error?.code === 'ENOENT') result.reason = 'Terraform executable unavailable';
else if (cli.status !== 0 || cli.error) { result.status = 'FAIL'; result.reason = 'Terraform version check failed'; }
else {
  if (!run(['fmt', '-check', '-recursive'])) result.status = 'FAIL';
  else if (!mirror || !existsSync(mirror)) result.reason = 'Installed offline AWS provider mirror unavailable; fmt passed, validate/test NOT_RUN';
  else result.status = run(['init', '-backend=false', '-input=false']) && run(['validate', '-no-color']) && run(['test', '-no-color']) ? 'PASS' : 'FAIL';
}
const evidence = join(resolve(scratch), 'terraform-offline-result.json');
writeFileSync(evidence, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ status: result.status, reason: result.reason, evidence }));
process.exitCode = result.status === 'PASS' ? 0 : result.status === 'NOT_RUN' ? 2 : 1;
