"""Synthetic loopback qualification; no payload or exhaustion workload."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
from collector import Windows, stamp, stop, write_json
from parser import parse, quantiles

HERE = Path(__file__).resolve().parent


def connect(port):
    started = time.perf_counter()
    with socket.create_connection(('127.0.0.1', port), timeout=1):
        return (time.perf_counter() - started)*1000


def workload(directory, mode):
    import select
    directory = Path(directory)
    native = Windows()
    if mode == 'cancellation':
        write_json(directory/'cancellation-ready.json', {'identity':native.identity(os.getpid()), **stamp()}, True)
        time.sleep(30)
        return 0
    server = socket.socket(); sockets = []; held = []; running = True; thread = None; peak = 0
    try:
        server.bind(('127.0.0.1', 0)); server.listen(16); server.settimeout(.005)
        port = server.getsockname()[1]
        def accept():
            nonlocal peak
            while running:
                readable = select.select(sockets, [], [], 0)[0] if sockets else []
                for sock in readable:
                    if not sock.recv(1, socket.MSG_PEEK):
                        sockets.remove(sock); sock.close()
                try:
                    child, _ = server.accept(); sockets.append(child); peak=max(peak,len(sockets))
                except socket.timeout:
                    pass
                except OSError:
                    break
        thread=threading.Thread(target=accept);thread.start()
        start = stamp(); identity = native.identity(os.getpid())
        held=[socket.create_connection(('127.0.0.1',port),timeout=1) for _ in range(4)]
        held_ready={'phase':'HELD_READY','port':port,'identity':identity,'tuples':[{'local':list(x.getsockname()),'remote':list(x.getpeername())} for x in held],**stamp()}
        write_json(directory/'held.json',held_ready,True)
        time.sleep(1)
        held_end=stamp()
        for sock in held:sock.close()
        held=[]
        phase_start=stamp(); phase_identity=native.identity(os.getpid())
        with ThreadPoolExecutor(max_workers=4) as pool:
            times=list(pool.map(lambda _:connect(port),range(64)))
        phase_end=stamp(); phase_final=native.identity(os.getpid())
        before_close=stamp();running=False;thread.join(1);server.close()
        if thread.is_alive():raise RuntimeError('ACCEPT_THREAD_NOT_CLOSED')
        for sock in sockets:sock.close()
        sockets=[]
        refused=None
        try:connect(port)
        except OSError as error:
            refused={'phase':'REFUSED_OR_TIMEOUT_AFTER_CLOSE','port':port,'winerror':getattr(error,'winerror',None),'errno':error.errno,'type':type(error).__name__,'message':str(error),'expectedKind':('BOUNDED_TIMEOUT' if isinstance(error,TimeoutError) else 'REFUSED' if isinstance(error,ConnectionRefusedError) and (getattr(error,'winerror',None)==10061 or error.errno in (10061,111)) else 'UNEXPECTED_ERROR'),'codeStatus':('UNAVAILABLE' if error.errno is None and getattr(error,'winerror',None) is None else 'OBSERVED'),**stamp()}
        if not refused:raise RuntimeError('EXPECTED_CONNECTION_FAILURE_MISSING')
        write_json(directory/'first-failure.json',refused,True)
        end=native.identity(os.getpid())
        result={'mode':mode,'start':start,'end':stamp(),'identity':identity,'finalIdentity':end,'heldReady':held_ready,'heldEnd':held_end,'beforeClose':before_close,'latencyMs':times,'distribution':quantiles(times),'wallMs':(time.perf_counter_ns()-start['monotonicNs'])/1e6,'connectionPhaseWallMs':(phase_end['monotonicNs']-phase_start['monotonicNs'])/1e6,'connectionPhaseCpu100ns':phase_final['cpu100ns']-phase_identity['cpu100ns'],'cpuDelta100ns':end['cpu100ns']-identity['cpu100ns'],'ioDelta':{k:end['io'][k]-identity['io'][k] for k in identity.get('io',{})},'refused':refused,'serverClosed':True,'peakServerSockets':peak,'peakClients':4}
        write_json(directory/'workload.json',result,True)
        return 7 if mode=='failure' else 0
    finally:
        running=False
        for sock in held:sock.close()
        if thread:thread.join(1)
        server.close()
        for sock in sockets:sock.close()

def wait_workload(child, timeout):
    try:
        return child.wait(timeout=timeout)
    finally:
        if child.poll() is None:
            child.terminate()
            try:child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill();child.wait(timeout=2)

def start_collector(directory, duration=120, max_bytes=8*1024*1024):
    directory.mkdir()
    token = uuid.uuid4().hex
    started = time.perf_counter()
    stdout = open(directory/'stdout.log', 'x'); stderr = open(directory/'stderr.log', 'x')
    child = subprocess.Popen([sys.executable, str(HERE/'collector.py'), 'run', '--directory', str(directory), '--token', token, '--parent', str(os.getpid()), '--duration', str(duration), '--max-bytes', str(max_bytes)], stdout=stdout, stderr=stderr)
    deadline = time.perf_counter()+2
    ready=False
    while child.poll() is None and time.perf_counter()<deadline:
        try:
            raw=(directory/'samples.ndjson').read_bytes()
            if raw.endswith(b'\n') and raw:
                json.loads(raw.splitlines()[0]);ready=True;break
        except (FileNotFoundError,json.JSONDecodeError):pass
        time.sleep(.01)
    startup = (time.perf_counter()-started)*1000
    if not ready and not (directory/'summary.json').exists():
        child.kill(); child.wait(timeout=2); stdout.close(); stderr.close()
        raise RuntimeError(f'COLLECTOR_START_FAILED:{directory}')
    return {'child': child, 'token': token, 'directory': directory, 'startupMs': startup, 'identity': json.loads((directory/'owner.json').read_text())['identity'], 'stdout': stdout, 'stderr': stderr}


def finish(record):
    started = time.perf_counter()
    stop(record['directory'], record['token']); stop(record['directory'], record['token'])
    try: code = record['child'].wait(timeout=2)
    except subprocess.TimeoutExpired:
        record['child'].kill(); record['child'].wait(timeout=2)
        raise RuntimeError('COLLECTOR_STOP_TIMEOUT_OWNED_CHILD_KILLED')
    finally:
        record['stdout'].close(); record['stderr'].close()
    after=Windows().identity(record['child'].pid)
    sameLive=after.get('birthFiletime')==record['identity'].get('birthFiletime') and after['status']=='OK' and after.get('active')
    return {'sameIdentityLiveAfterExit':sameLive, 'code': code, 'stopWallMs': (time.perf_counter()-started)*1000, 'startupMs': record['startupMs'], 'identityAfterExit': after}


def independent_probe(directory):
    native=Windows()
    with socket.socket() as server:
        server.bind(('127.0.0.1',0));server.listen(1)
        port=server.getsockname()[1]
        with socket.create_connection(('127.0.0.1',port),timeout=1) as client:
            with server.accept()[0] as peer:
                before=stamp();identity=native.identity(os.getpid());snapshot=native.tcp()
                command=f'Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort {port} -State Established -ErrorAction Stop | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess,State | ConvertTo-Json -Compress'
                observed=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',command],capture_output=True,text=True,timeout=8)
                (directory/'independent-tcp.stdout.log').write_text(observed.stdout)
                (directory/'independent-tcp.stderr.log').write_text(observed.stderr)
                rows=json.loads(observed.stdout) if observed.returncode==0 else []
                if isinstance(rows,dict):rows=[rows]
                matched=observed.returncode==0 and any(r['OwningProcess']==os.getpid() and r['LocalPort']==port and r['RemotePort']==client.getsockname()[1] for r in rows)
                nativeMatched=any(r['pid']==os.getpid() and r['local'][1]==port and r['remote'][1]==client.getsockname()[1] and r['identity'].get('birthFiletime')==identity.get('birthFiletime') and r['state']==5 for r in snapshot.get('rows',[]))
                result={'before':before,'after':stamp(),'identity':identity,'port':port,'clientEndpoint':list(client.getsockname()),'native':snapshot,'independentExit':observed.returncode,'independentRows':rows,'matched':matched and nativeMatched}
    write_json(directory/'independent-probe.json',result,True)
    return result

def qualify(directory):
    directory = Path(directory); directory.mkdir(parents=True, exist_ok=False)
    token = uuid.uuid4().hex; write_json(directory/'qualification-owner.json', {'token': token, 'pid': os.getpid(), **stamp()}, True)
    native = Windows(); blocks = []; special = []; active = None
    report = {'schema': 'IEMS_QUALIFICATION_V1', 'environment': {'platform': platform.platform(), 'python': sys.version, 'node': subprocess.check_output(['node', '--version'], text=True).strip(), 'runnerOS': os.environ.get('RUNNER_OS'), 'imageOS': os.environ.get('ImageOS'), 'imageVersion': os.environ.get('ImageVersion'), 'processorCount': os.cpu_count(), 'elevated': bool(__import__('ctypes').windll.shell32.IsUserAnAdmin())}, 'command': sys.argv, 'cwd': str(Path.cwd()), 'sources': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in HERE.glob('*.py')}, 'blocks': blocks, 'special': special, 'gates': {}, 'limitations': ['IPv4 snapshot only; no kernel allocation ownership', 'Alternating fixed order, cold-start and host confounds retained', 'Synthetic refusal is not10055', 'Hard VM termination not tested', 'No ETW sessions created']}
    try:
        probe=independent_probe(directory);report['independentProbeMatched']=probe['matched']
        for index in range(8):
            on = index % 2 == 1
            block = directory / f'block-{index}-{"on" if on else "off"}'
            block.mkdir(); collector = block/'collector'
            if on:
                active = start_collector(collector)
                duplicate=subprocess.run([sys.executable,str(HERE/'collector.py'),'run','--directory',str(collector),'--token',active['token'],'--parent',str(os.getpid())],capture_output=True,text=True,timeout=2)
                write_json(block/'duplicate-start.json',{'exit':duplicate.returncode,'stdout':duplicate.stdout,'stderr':duplicate.stderr},True)
                if duplicate.returncode or 'ALREADY_RUNNING' not in duplicate.stdout:raise RuntimeError('IDEMPOTENT_START_FAILED')
            output = open(block/'stdout.log', 'x'); error = open(block/'stderr.log', 'x')
            child = subprocess.Popen([sys.executable, str(__file__), '--workload', str(block), '--mode', 'normal'], stdout=output, stderr=error)
            code = wait_workload(child,15); output.close(); error.close()
            closure = finish(active) if active else None; active = None
            result = json.loads((block/'workload.json').read_text()); result.update(index=index, on=on, childExit=code, closure=closure)
            if on:
                parsed = parse(collector); result['collectorSummary'] = {k:v for k,v in parsed.items() if k != 'samples'}
                held = json.loads((block/'held.json').read_text()); identity = held['identity']
                result['correlation'] = any(s['monotonicNs']>=held['monotonicNs'] and s['endStamp']['monotonicNs']<=result['heldEnd']['monotonicNs'] and any(r['pid']==identity['pid'] and r['identity'].get('birthFiletime')==identity.get('birthFiletime') and r['local'][1]==held['port'] and r['remote'] in [t['local'] for t in held['tuples']] and r['state'] == 5 for r in s['tcp'].get('rows', [])) for s in parsed['samples'])
            blocks.append(result)
        for mode in ('failure', 'cancellation', 'duration', 'size'):
            folder = directory/f'special-{mode}'; folder.mkdir()
            active = start_collector(folder/'collector', duration=.3 if mode=='duration' else 120, max_bytes=1024 if mode=='size' else 8*1024*1024)
            child_code = None
            if mode == 'failure':
                child = subprocess.Popen([sys.executable,str(__file__),'--workload',str(folder),'--mode','failure']); child_code=wait_workload(child,15)
            elif mode == 'cancellation':
                child=subprocess.Popen([sys.executable,str(__file__),'--workload',str(folder),'--mode','cancellation'])
                time.sleep(.4); child.terminate(); child_code=wait_workload(child,2)
            else:
                time.sleep(.4)
            closure = finish(active); active = None
            parsed = parse(folder/'collector')
            wrong_token = False
            try: stop(folder/'collector','WRONG')
            except ValueError: wrong_token=True
            special.append({'mode':mode,'childExit':child_code,'closure':closure,'summary':parsed['summary'],'wrongTokenRejected':wrong_token,'parserSha256':parsed['sha256']})
        off=[b for b in blocks if not b['on']]; on=[b for b in blocks if b['on']]
        offq=quantiles([v for b in off for v in b['latencyMs']]); onq=quantiles([v for b in on for v in b['latencyMs']])
        cpu=[]; rss=[]; sample_cost=[]
        for b in on:
            parsed=parse(directory/f'block-{b["index"]}-on'/'collector'); samples=parsed['samples']
            if len(samples)>1:
                cpu.append((samples[-1]['collector']['cpu100ns']-samples[0]['collector']['cpu100ns'])/1e7/((samples[-1]['monotonicNs']-samples[0]['monotonicNs'])/1e9))
            rss.extend(s['collector'].get('workingSetBytes',float('inf')) for s in samples); sample_cost.extend(s['sampleCostMs'] for s in samples)
        costs={'offLatencyMs':offq,'onLatencyMs':onq,'offWallMs':quantiles([b['wallMs'] for b in off]),'onWallMs':quantiles([b['wallMs'] for b in on]),'offConnectionWallMs':quantiles([b['connectionPhaseWallMs'] for b in off]),'onConnectionWallMs':quantiles([b['connectionPhaseWallMs'] for b in on]),'collectorCpuCores':quantiles(cpu),'collectorRssBytes':quantiles(rss),'sampleCostMs':quantiles(sample_cost),'startupMs':quantiles([b['closure']['startupMs'] for b in on]),'stopMs':quantiles([b['closure']['stopWallMs'] for b in on])}; report['costs']=costs
        gates=report['gates']
        gates['Q1']=all(b['collectorSummary']['summary']['errors']==0 and 'workingSetBytes' in b['collectorSummary']['summary']['collector'] and 'io' in b['collectorSummary']['summary']['collector'] for b in on)
        gates['Q2']=probe['matched'] and all(b['correlation'] and b['refused']['expectedKind'] in ('BOUNDED_TIMEOUT','REFUSED') for b in on)
        gates['Q3']=onq['p95']<=max(offq['p95']*1.5,offq['p95']+2) and costs['onConnectionWallMs']['p50']<=max(costs['offConnectionWallMs']['p50']*1.5,costs['offConnectionWallMs']['p50']+10) and max(cpu)<=.25 and max(rss)<=64*1024*1024 and costs['sampleCostMs']['p95']<=50 and costs['startupMs']['max']<=2000 and costs['stopMs']['max']<=2000
        negative=subprocess.run([sys.executable,'-m','unittest','discover','-s',str(HERE),'-p','test_collector.py','-v'],capture_output=True,text=True,timeout=15)
        (directory/'parser-negative-tests.log').write_text(negative.stdout+negative.stderr)
        report['parserNegativeTestsExit']=negative.returncode
        gates['Q4']=negative.returncode==0 and all(s['summary']['bytes']<=8*1024*1024 and s['summary']['durationMs']<=121000 for s in special) and next(s for s in special if s['mode']=='duration')['summary']['reason']=='DURATION_LIMIT' and next(s for s in special if s['mode']=='size')['summary']['reason']=='SIZE_LIMIT'
        gates['Q5']=all(s['closure']['code']==0 and s['wrongTokenRejected'] for s in special) and next(s for s in special if s['mode']=='failure')['childExit']==7
        gates['Q6']=all(not b['closure']['sameIdentityLiveAfterExit'] for b in on) and all(not s['closure']['sameIdentityLiveAfterExit'] for s in special) and all(b['childExit']==0 and b['serverClosed'] and b['peakServerSockets']<=8 for b in blocks) and all(b['closure']['code']==0 for b in on) and all(s['closure']['code']==0 for s in special)
        replay={str(p.relative_to(directory)):parse(p.parent)['sha256'] for p in directory.rglob('samples.ndjson')}
        report['parserReplay']=replay
        gates['Q7']=len(replay)==8
        report['verdict']='COLLECTOR_QUALIFIED' if all(gates.values()) else 'REJECTED_WITH_EVIDENCE'
    except Exception as error:
        report['error']={'type':type(error).__name__,'message':str(error)};report['verdict']='INCONCLUSIVE'
        raise
    finally:
        if active:
            try: report['emergencyCleanup']=finish(active)
            except Exception as error: report['emergencyCleanupError']=str(error)
        write_json(directory/'qualification.json',report,True)
        hashes={str(p.relative_to(directory)):hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.rglob('*') if p.is_file()}
        write_json(directory/'checksums.json',hashes,True)
    print(json.dumps({'verdict':report['verdict'],'gates':report['gates'],'costs':report.get('costs')},indent=2))
    return 0 if report['verdict']=='COLLECTOR_QUALIFIED' else 1


if __name__=='__main__':
    args=argparse.ArgumentParser();args.add_argument('--directory');args.add_argument('--workload');args.add_argument('--mode',default='normal');args=args.parse_args()
    raise SystemExit(workload(args.workload,args.mode) if args.workload else qualify(args.directory))
