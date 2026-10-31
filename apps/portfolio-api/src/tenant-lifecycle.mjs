import { createTenantLifecycle, lifecycleRoles } from '../../../packages/tenant-lifecycle/index.mjs';
import { CommandError } from '../../../packages/tenant-foundation/commands.mjs';
export { lifecycleRoles };
export const createTenantLifecycleRuntime = (runtime, options = {}) => createTenantLifecycle({...runtime,...options});
export function installTenantLifecycle(app, lifecycle) {
  const input = (req, read=false) => {
    if (!req.scope?.selectedPlantId) throw new CommandError('SCOPE_DENIED',403);
    if (Object.keys(req.query ?? {}).length) throw new CommandError('INVALID_SAAS_REQUEST',400);
    const body=read ? {} : req.body;
    if (!body || Object.getPrototypeOf(body)!==Object.prototype || ['tenantId','plantId','userId'].some(k=>Object.hasOwn(body,k))) throw new CommandError('INVALID_SAAS_REQUEST',400);
    return {...body,plantId:req.scope.selectedPlantId};
  };
  app.get('/api/saas/status',async (req,res)=>res.set('Cache-Control','no-store').json({data:await lifecycle.status(req.scope,input(req,true))}));
  for (const action of ['subscribe','meter','suspend','resume','export','delete','restore','download']) {
    app.post(`/api/saas/${action}`,async (req,res)=>res.set('Cache-Control','no-store').json({data:await lifecycle[action](req.scope,input(req))}));
  }
}
