import { createTenantLifecycle, lifecycleRoles } from '../../../packages/tenant-lifecycle/index.mjs';
import { CommandError } from '../../../packages/tenant-foundation/commands.mjs';
export { lifecycleRoles };
export const createTenantLifecycleRuntime = (runtime, options = {}) => createTenantLifecycle({...runtime,...options});
export function installTenantLifecycle(app, lifecycle, effects) {
  const input = (req, read=false) => {
    if (!req.scope?.selectedPlantId) throw new CommandError('SCOPE_DENIED',403);
    if (Object.keys(req.query ?? {}).length) throw new CommandError('INVALID_SAAS_REQUEST',400);
    const body=read ? {} : req.body;
    if (!body || Object.getPrototypeOf(body)!==Object.prototype || ['tenantId','plantId','userId'].some(k=>Object.hasOwn(body,k))) throw new CommandError('INVALID_SAAS_REQUEST',400);
    return {...body,plantId:req.scope.selectedPlantId};
  };
  app.get('/api/saas/status',async (req,res)=>res.set('Cache-Control','no-store').json({data:await lifecycle.status(req.scope,input(req,true))}));
  app.get('/api/saas/effects/:id',async(req,res)=>{input(req,true);res.set('Cache-Control','no-store').json({data:await effects.status(req.scope,req.params.id)});});
  app.post('/api/saas/effects/:id/continue',async(req,res)=>{const body=input(req);if(Object.keys(body).some(k=>!['plantId','phase'].includes(k))||body.phase!==undefined&&(typeof body.phase!=='string'||body.phase.length>100))throw new CommandError('INVALID_EFFECT_PHASE',400);await effects.rebind(req.scope,req.params.id);res.set('Cache-Control','no-store').json({data:await effects.run(req.params.id,body.phase??'EFFECT')});});
  app.post('/api/saas/effects/:id/observe',async(req,res)=>{const body=input(req);if(Object.keys(body).some(k=>!['plantId','phase'].includes(k))||body.phase!==undefined&&(typeof body.phase!=='string'||body.phase.length>100))throw new CommandError('INVALID_EFFECT_PHASE',400);await effects.rebind(req.scope,req.params.id);res.set('Cache-Control','no-store').json({data:await effects.observe(req.params.id,body.phase??'EFFECT')});});
  for (const action of ['subscribe','meter','suspend','resume','export','delete','restore','download','quiesce']) {
    app.post(`/api/saas/${action}`,async (req,res)=>res.set('Cache-Control','no-store').json({data:await lifecycle[action](req.scope,input(req))}));
  }
}
