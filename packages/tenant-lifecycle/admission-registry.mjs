import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CommandError } from '../tenant-foundation/commands.mjs';
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export const admissionRegistry = freeze(JSON.parse(await readFile(new URL('./admission-registry.json',import.meta.url),'utf8')));
if(admissionRegistry.schema!=='SAAS_ADMISSION_REGISTRY_V1'||admissionRegistry.profile!=='RECEIPTED_COMMANDS_V1'||admissionRegistry.fullEndpointCoverage!==false) throw new CommandError('SAAS_REGISTRY_CONFIGURATION_INVALID',503);
export function registeredRoutes(app) {
  return app.router.stack.filter(layer=>layer.route).flatMap(layer=>Object.keys(layer.route.methods).map(method=>`${method.toUpperCase()} ${layer.route.path}`)).sort();
}
export function validateAdmissionRoutes(app) {
  if(JSON.stringify(registeredRoutes(app))!==JSON.stringify(admissionRegistry.routes.map(row=>row.route))) throw new CommandError('SAAS_HOST_ROUTES_UNREGISTERED',503);
}
export async function verifyAdmissionSources() {
  for(const [path,digest] of Object.entries(admissionRegistry.sources)) {
    const source=(await readFile(new URL(`../../${path}`,import.meta.url),'utf8')).replaceAll('\r\n','\n');
    if(createHash('sha256').update(source).digest('hex')!==digest) throw new CommandError('SAAS_HOST_SOURCE_CHANGED',503);
  }
}
