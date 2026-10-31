import { createCommandExecutor } from '../../../packages/tenant-foundation/index.mjs';

export async function initializeFoundationRuntime(runtime) {
  const commands = createCommandExecutor({ ...runtime, admission: runtime.saasAdmission.effect });
  await commands.initialize();
  return commands;
}
