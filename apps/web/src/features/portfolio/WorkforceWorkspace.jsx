import { useContext, useEffect, useRef, useState } from 'react';
import { IdentityContext, Resource, Failure, useResource } from './PortfolioWorkspace.jsx';
import { portfolioRequest } from './client.mjs';
import Field from '../../components/forms/WorkspaceField.jsx';
import State from '../../components/ui/WorkspaceState.jsx';
import RecordShell from '../../components/layout/RecordShell.jsx';
import { workforceRoot, showTime } from './operations.mjs';

export function OperationCommand({ title, action, path, version, build = v=>v, children, onSaved, privateInput = false }) {
  const identity=useContext(IdentityContext), [busy,setBusy]=useState(false), [error,setError]=useState(null), [result,setResult]=useState(null), [pending,setPending]=useState(false);
  const lock=useRef(false), alive=useRef(false), attempt=useRef(null), alert=useRef(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;attempt.current=null;};},[]);
  useEffect(()=>{if(error) alert.current?.focus();},[error]);
  if (!identity?.permissions?.includes(action)) return null;
  async function send() {
    if(lock.current || !attempt.current) return;lock.current=true;setBusy(true);setError(null);
    try {const value=await portfolioRequest(path,{body:attempt.current});if(alive.current){setResult(value.data);setPending(false);attempt.current=null;onSaved?.(value.data);}}
    catch(e){if(alive.current)setError(e);}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  return <form className="pf-panel pf-form" onSubmit={e=>{
    e.preventDefault();if(lock.current || pending)return;
    try{attempt.current={...build(Object.fromEntries(new FormData(e.currentTarget))),expectedVersion:version,idempotencyKey:crypto.randomUUID()};setPending(true);setResult(null);if(privateInput)e.currentTarget.reset();send();}catch(e){setError(e);}
  }}><h3>{title}</h3><fieldset className="pf-form" disabled={pending || busy}>{children}</fieldset>
    {!pending && <button disabled={busy}>{title}</button>}{busy && <p role="status">Saving…</p>}
    {error && <div ref={alert} tabIndex={-1}><Failure error={error} mutation/>{pending && <><p>The command is retained in memory until you reconcile or discard it.</p>{(!error.status || error.status>=500) && <button type="button" disabled={busy} onClick={send}>Retry same command</button>}<button type="button" disabled={busy} onClick={()=>{attempt.current=null;setPending(false);setError(null);onSaved?.();}}>Discard and refresh</button></>}</div>}
    {result && <State kind={result.status==='REJECTED'?'error':'success'} title={result.status==='REJECTED'?'Verification rejected':result.status==='VERIFIED'?'Identity verified':'Saved'}>{result.reason && <p>{result.reason.replaceAll('_',' ')}.</p>}{result.expiresAt && <p>Valid until {showTime(result.expiresAt)}.</p>}</State>}
  </form>;
}
export function WorkforceWorkspace() {
  const [operator,setOperator]=useState(''), [target,setTarget]=useState(null), capabilities=useResource(`${workforceRoot}/capabilities`);
  return <><h1>Workforce verification</h1><p>Verify one claimed identity at a time. NFC and PIN remain available without face consent. Biometric enrollment is not available here.</p>
    <Resource resource={capabilities}>{({data})=><State title={data.configured?'Verification service configured':'Verification service unavailable'}>{!data.configured && <p>Ask the system owner to configure the private verification service.</p>}<p>{data.faceVerification?'A trusted face assertion verifier is configured.':'Face verification is unavailable. Use a configured NFC or PIN fallback.'}</p></State>}</Resource>
    <form className="pf-panel pf-form" onSubmit={e=>{e.preventDefault();setTarget(operator);}}><Field name="operatorId" label="Operator ID" value={operator} onChange={e=>setOperator(e.target.value)} required pattern="[0-9a-fA-F-]{36}"/><button>Open operator</button></form>
    {target && <Operator key={target} operatorId={target}/>}
  </>;
}
function Operator({operatorId}) {
  const identity=useContext(IdentityContext), path=`${workforceRoot}/operators/${encodeURIComponent(operatorId)}`, resource=useResource(path), [challenge,setChallenge]=useState(null), [device,setDevice]=useState('');
  const self=identity?.user?.id===operatorId;
  return <Resource resource={resource}>{({data})=><RecordShell title="Operator verification" reference={operatorId} status={data.consent.active?'Face consent recorded':'Face consent absent'} updatedAt={data.updatedAt}>
    <p>Revision {data.version}. PIN: {data.pinConfigured?'Configured':'Not configured'}. NFC: {data.nfcConfigured?'Configured':'Not configured'}.</p>
    <p>Face consent expires {showTime(data.consent.expiresAt)}. Expired or withdrawn consent blocks face verification immediately.</p>
    {self && <><OperationCommand key={`consent:${data.version}`} title="Update face consent" action="workforce.consent" path={`${path}/consent`} version={data.version} onSaved={()=>{setChallenge(null);resource.reload();}} build={v=>({active:v.active==='true',purpose:'ATTENDANCE_VERIFICATION',...(v.active==='true'?{expiresAt:v.expiresAt}:{})})}>
      <p>Optional face verification uses a trusted assertion for attendance verification. You may withdraw consent and use NFC or PIN.</p>
      <Field label="Your choice" name="active" as="select"><option value="false">Withdraw / do not consent</option><option value="true">I consent to 1:1 face verification</option></Field>
      <Field label="Consent expiry (UTC, required when consenting)" name="expiresAt" placeholder="2026-12-01T00:00:00.000Z"/>
    </OperationCommand>
    <OperationCommand key={`pin:${data.version}`} title="Set PIN" action="workforce.configure" path={`${path}/configure`} version={data.version} onSaved={()=>{setChallenge(null);resource.reload();}} privateInput>
      <Field label="New PIN" name="pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{8,12}" minLength={8} maxLength={12} required hint="Use 8–12 digits. The PIN is never returned by the server."/>
    </OperationCommand>
    <OperationCommand key={`nfc:${data.version}`} title="Set NFC credential" action="workforce.configure" path={`${path}/configure`} version={data.version} onSaved={()=>{setChallenge(null);resource.reload();}} privateInput>
      <Field label="NFC reader token" name="nfcToken" type="password" autoComplete="off" pattern="[A-Za-z0-9_-]{16,128}" required hint="Use the opaque token from your approved reader; no reader event is invented."/>
    </OperationCommand>
    <OperationCommand key={`remove:${data.version}`} title="Remove fallback credentials" action="workforce.configure" path={`${path}/configure`} version={data.version} build={()=>({pin:null,nfcToken:null})} onSaved={()=>{setChallenge(null);resource.reload();}}><p>This removes your registered PIN and NFC credential.</p></OperationCommand></>}
    <Field label="Registered kiosk ID" name="deviceId" value={device} onChange={e=>{setDevice(e.target.value);setChallenge(null);}}/>
    <OperationCommand key={`challenge:${data.version}:${device}`} title="Start verification" action="workforce.challenge" path={`${path}/challenge`} version={data.version} build={v=>({...v,deviceId:device})} onSaved={value=>setChallenge(value || null)}>
      <Field label="Verification method" name="method" as="select"><option value="PIN">PIN fallback</option><option value="NFC">NFC fallback</option><option value="FACE">Consented face assertion</option></Field>
    </OperationCommand>
    {challenge && <section><h3>One-time verification</h3><p>Challenge expires {showTime(challenge.expiresAt)}. Rejected, expired or consumed challenges require a new attempt.</p>
      {challenge.method==='FACE' && <p>Use your approved capture device with challenge {challenge.challengeId} and nonce {challenge.nonce}. This workspace does not capture or enroll a face.</p>}
      <OperationCommand key={challenge.challengeId} title="Verify identity" action="workforce.verify" path={`${path}/verify`} version={1} privateInput build={v=>({...v,challengeId:challenge.challengeId,deviceId:device})}>
        <Field label={challenge.method==='FACE'?'Signed assertion reference':challenge.method==='PIN'?'PIN':'NFC reader token'} name="proof" type="password" autoComplete="off" required maxLength={512}/>
      </OperationCommand>
    </section>}
  </RecordShell>}</Resource>;
}
