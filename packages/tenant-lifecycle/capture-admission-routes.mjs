import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {startOwned} from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import {createApp} from '../../apps/portfolio-api/src/app.mjs';
import {registeredRoutes} from './admission-registry.mjs';
process.env.MONGOMS_RUNTIME_DOWNLOAD='false';
test('capture actual assembled routes while preserving startup rejection',async t=>{
 let routes;
 try{const h=await startOwned(t);routes=registeredRoutes(createApp(h.runtime,{origins:['http://localhost:4173']}));}
 catch(error){assert.equal(error.code,'SAAS_HOST_ROUTES_UNREGISTERED');routes=error.actualRoutes;}
 assert.ok(Array.isArray(routes)&&routes.length>=400);assert.equal(new Set(routes).size,routes.length);
 await writeFile(new URL('./admission-routes.json',import.meta.url),JSON.stringify(routes,null,2)+'\n');
 console.log(`Captured ${routes.length} actual routes; startup verification is never bypassed.`);
});
