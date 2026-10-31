import { useState } from 'react';
import { Resource, useResource } from './PortfolioWorkspace.jsx';
import { OperationCommand } from './WorkforceWorkspace.jsx';
import Field from '../../components/forms/WorkspaceField.jsx';
import Table from '../../components/tables/WorkspaceTable.jsx';
import State from '../../components/ui/WorkspaceState.jsx';
import TtsAutoAnnouncementPlayer from '../../components/TtsAutoAnnouncementPlayer.jsx';
import { voiceRoot, showTime, showValue } from './operations.mjs';

export function VoiceWorkspace() {
  const resource=useResource(`${voiceRoot}/zones`),[selected,setSelected]=useState(null),[newId,setNewId]=useState(()=>crypto.randomUUID());
  return <><h1>Zone voice</h1><p>Review aging warnings, generate audio with the configured model, then publish it to one plant zone.</p>
    <Resource resource={resource}>{({data,capabilities})=><section className="pf-panel"><h2>Plant zones</h2>
      {!capabilities?.realModelConfigured && <State title="Real voice model unavailable">Generation and publication remain closed until the system owner configures a pinned model and owned audio store.</State>}
      <Table caption="Voice zones" rows={data} rowKey={r=>r.resourceId} columns={[{key:'label',label:'Zone',render:r=><button onClick={()=>setSelected(r.resourceId)}>{r.label}</button>},{key:'active',label:'State',render:r=>r.active?'Enabled':'Disabled'},{key:'playback',label:'Player',render:r=>r.playback?`${r.playback.playerId}; lease until ${showTime(r.playback.expiresAt)}`:'Idle'}]}/><button onClick={resource.reload}>Refresh zones</button>
    </section>}</Resource>
    <OperationCommand key={newId} title="Register zone" action="operations.configure" path={`${voiceRoot}/zones/${newId}/configure`} version={0} build={v=>({...v,active:true})} onSaved={v=>{resource.reload();if(v){setSelected(v.resourceId);setNewId(crypto.randomUUID());}}}><Field label="Zone name" name="label" required maxLength={100}/></OperationCommand>
    {selected && <Zone key={selected} zoneId={selected} onSaved={resource.reload}/>}
  </>;
}
function Zone({zoneId,onSaved}) {
  const path=`${voiceRoot}/zones/${zoneId}`,resource=useResource(path),[playerId,setPlayerId]=useState(''),[enabled,setEnabled]=useState(false);
  const refresh=()=>{resource.reload();onSaved();};
  return <Resource resource={resource}>{({data})=><section className="pf-panel"><h2>{data.label}</h2><p>Revision {data.version}. {data.active?'Zone enabled.':'Zone disabled.'}</p>
    <OperationCommand key={`configure:${data.version}`} title="Update zone" action="operations.configure" path={`${path}/configure`} version={data.version} build={v=>({...v,active:v.active==='true'})} onSaved={refresh}><Field label="Zone name" name="label" defaultValue={data.label} required maxLength={100}/><Field label="Zone state" name="active" as="select" defaultValue={String(data.active)}><option value="true">Enabled</option><option value="false">Disabled</option></Field></OperationCommand>
    <OperationCommand key={`queue:${data.version}`} title="Queue aging warning" action="operations.enqueue" path={`${path}/enqueue`} version={data.version} build={v=>({...v,sourceVersion:Number(v.sourceVersion)})} onSaved={refresh}><Field label="Work order ID" name="workOrderId" required pattern="[0-9a-fA-F-]{36}"/><Field label="Current work order revision" name="sourceVersion" type="number" min="1" step="1" required/><p>Only an active production record with no update for at least seven days can be announced. The server creates the announcement from that record.</p></OperationCommand>
    <Field label="Registered zone player ID" name="playerId" value={playerId} onChange={e=>{setEnabled(false);setPlayerId(e.target.value);}}/>
    <button onClick={()=>setEnabled(v=>!v)} disabled={!playerId || !data.active}>{enabled?'Stop this player':'Enable this player'}</button>
    <TtsAutoAnnouncementPlayer enabled={enabled} zoneId={zoneId} playerId={playerId}/>
    {data.playback && <OperationCommand key={`recover:${data.version}`} title="Recover expired player lease" action="operations.recover" path={`${path}/recover`} version={data.version} onSaved={refresh}><p>Recovery is available only after {showTime(data.playback.expiresAt)}. It does not report the audio as played.</p></OperationCommand>}
    <Table caption="Zone announcements" rows={data.jobs} rowKey={r=>r.resourceId} columns={[{key:'text',label:'Announcement'},{key:'status',label:'State'},{key:'generationLatencyMs',label:'Generation (ms)',numeric:true,render:r=>showValue(r.generationLatencyMs)},{key:'playerLatencyMs',label:'Player start (ms)',numeric:true,render:r=>showValue(r.playerLatencyMs)},{key:'error',label:'Recovery',render:r=>r.error || 'No error recorded'}]}/>
    {data.jobs.map(j=><details key={j.resourceId}><summary>{j.status}: {j.resourceId}</summary><p>Source revision {j.source.businessRevision}. Actual model: {j.modelId || 'Not generated'}. Duration: {showValue(j.durationMs,'ms')}.</p>
      {j.status==='READY' && <OperationCommand title="Publish to zone" action="operations.publish" path={`${voiceRoot}/jobs/${j.resourceId}/publish`} version={j.version} onSaved={refresh}><p>Publish this verified artifact for local zone playback.</p></OperationCommand>}
      {j.status==='GENERATING' && <OperationCommand title="Recover expired generation" action="operations.recover" path={`${voiceRoot}/jobs/${j.resourceId}/recover`} version={j.version} onSaved={refresh}><p>Only an expired generation lease can be recovered. Attempts are bounded to three.</p></OperationCommand>}
      {!['PLAYING','PLAYED','CANCELLED'].includes(j.status) && <OperationCommand title="Cancel announcement" action="operations.cancel" path={`${voiceRoot}/jobs/${j.resourceId}/cancel`} version={j.version} onSaved={refresh}><p>Cancel this queued or unpublished announcement.</p></OperationCommand>}
    </details>)}<button onClick={resource.reload}>Refresh zone history</button>
  </section>}</Resource>;
}
