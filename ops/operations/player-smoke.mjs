import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';
import { chromium } from 'file:///C:/Users/Admin/.paperclip/instances/default/tools/t-project/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output=process.argv[2];if(!output)throw new Error('Evidence output path required');
const audioFixture=await readFile(resolve('apps/tts-worker/header.mp3'));
const root=resolve('apps/web');process.chdir(root);
const id='11111111-1111-4111-8111-111111111111',server=await createServer({root,plugins:[{name:'owned-player-page',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
 if(!req.url.startsWith('/__owned_player'))return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,`<html><body><div id="app"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import Player from '/src/components/TtsAutoAnnouncementPlayer.jsx';window.ownedRoot=createRoot(document.getElementById('app'));window.ownedRoot.render(React.createElement(Player,{enabled:true,zoneId:'${id}',playerId:'synthetic-player',pollIntervalMs:3000}));</script></body></html>`));
 });}}],server:{host:'127.0.0.1',port:0}});
let browser;const startedBodies=[],playedBodies=[],errors=[];let firstStart=true;
try{
 await server.listen();browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage();
 await page.addInitScript(()=>{window.syntheticPlayCount=0;HTMLMediaElement.prototype.play=function(){window.syntheticPlayCount++;return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){};HTMLMediaElement.prototype.load=function(){};});
 page.on('pageerror',e=>errors.push(e.message));
 const lease={resourceId:id,version:2,playback:{jobId:id,playerId:'synthetic-player',expiresAt:new Date(Date.now()+60000).toISOString()},playbackToken:'synthetic-token',streamUrl:`/api/operations/voice/zones/${id}/audio/${id}`};
 await page.route('**/portfolio-api/**',async route=>{
  const path=new URL(route.request().url()).pathname;let data;
  if(path.includes('/audio/'))return route.fulfill({contentType:'audio/mpeg',body:audioFixture});
  if(path.endsWith('/lease'))data=lease;
  else if(path.endsWith('/started')){startedBodies.push(route.request().postDataJSON());if(firstStart){firstStart=false;return route.abort('failed');}data={...lease,version:3};}
  else if(path.endsWith('/played')){playedBodies.push(route.request().postDataJSON());data={resourceId:id,version:4,playback:null};}
  else data={resourceId:id,version:1,active:true,playback:null};
  return route.fulfill({contentType:'application/json',body:JSON.stringify({data})});
 });
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__owned_player`);
 await page.getByText('Audio started; start receipt is unconfirmed. Retry the same receipt.').waitFor();
 await page.getByRole('button',{name:'Retry current player action'}).evaluate(button=>{button.click();button.click();});
 await page.getByText('Playing zone announcement',{exact:true}).waitFor();assert.equal(startedBodies.length,2);assert.deepEqual(startedBodies[0],startedBodies[1]);assert.equal(await page.evaluate(()=>window.syntheticPlayCount),1);
 await page.locator('audio').evaluate(audio=>{audio.dispatchEvent(new Event('ended'));audio.dispatchEvent(new Event('ended'));});
 await page.getByText('Playback confirmed',{exact:true}).waitFor();assert.equal(playedBodies.length,1);assert.equal(playedBodies[0].expectedVersion,3);
 await page.evaluate(()=>window.ownedRoot.unmount());await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));assert.deepEqual(errors,[]);
 await writeFile(resolve(output,'player-inspection.json'),JSON.stringify({result:'PASS',fixture:'SYNTHETIC_HTTP_AND_MEDIA_METHODS_ONLY',realAudioPlayback:'NOT_RUN',startedRetrySameBody:true,duplicateRetrySuppressed:true,playedOnlyAfterEnded:true,duplicateEndedSuppressed:true,unmountCompleted:true,errors},null,2));
 console.log('PASS synthetic player state transitions; real audio NOT_RUN');
}catch(error){const pages=browser?.contexts()[0]?.pages();console.error(JSON.stringify({text:pages?.[0]?await pages[0].locator('body').innerText():null,startedBodies,playedBodies,errors}));throw error;}finally{await browser?.close();await server.close();}
