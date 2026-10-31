"""Deferred final-QA probe; creates only a new explicit synthetic directory."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from uuid import uuid4
from events import canonical, digest, now
from raw import ingest, read_batch
from marts import load, parity


def run(root,project):
    root=Path(root).resolve()
    if root.exists():
        raise ValueError('Probe requires a NEW isolated directory; existing data is never reused or deleted')
    root.mkdir(parents=True,exist_ok=False)
    profiles=root/'profiles'; profiles.mkdir()
    (profiles/'profiles.yml').write_text('iems_reporting:\n  target: local\n  outputs:\n    local:\n      type: duckdb\n      path: "{{ env_var(\'IEMS_ANALYTICS_DB\') }}"\n      threads: 2\n',encoding='utf8')
    tenant,plant,order,payment,delivery,entity=[str(uuid4()) for _ in range(6)]
    def event(aggregate,version,kind,payload):
        at=now()
        source={'collection':'salesOrders' if kind=='order' else 'fulfillmentKeys','id':aggregate,'version':version,'hash':digest(payload),'eventIds':[],'sourceOccurredAt':at,'mappingVersion':1}
        e={'eventId':str(uuid4()),'schemaVersion':2,'tenantId':tenant,'plantId':plant,'aggregateId':aggregate,'aggregateVersion':version,'type':'reporting.snapshot.v2','occurredAt':at,'payload':{'resourceType':kind,'resourceId':aggregate,'legalEntityId':entity,'baseline':False,'deleted':False,'source':source,**payload}}
        return {'event':e,'receivedAt':at,'availableAt':at}
    records=[event(order,1,'order',{'amount':'100.00','currency':'USD','quantities':[{'quantity':'10.000','uom':'EA'},{'quantity':'2.000','uom':'M'}]}),event(payment,1,'payment',{'orderId':order,'amount':'25.00','currency':'USD'}),event(delivery,1,'fulfillment',{'orderId':order,'quantity':'3.000','uom':'EA'})]
    def coverage(records,label):
        heads={r['event']['aggregateId']:r['event'] for r in records}
        m={'runId':str(uuid4()),'tenantId':tenant,'plantId':plant,'legalEntityId':entity,'observedAt':now(),'coverage':'COMPLETE','trustedZero':True,'quarantine':[],'unsupported':[],'fence':'single-snapshot-transaction','snapshotHeads':[{'aggregateId':e['aggregateId'],'aggregateVersion':e['aggregateVersion'],'eventId':e['eventId'],'hash':digest(e)} for e in heads.values()]}
        m['hash']=digest(m); path=root/(label+'.coverage.json'); path.write_text(canonical(m)); return path
    raw=root/'raw'
    first=ingest(records,raw,'iems.reporting.snapshots.v2:synthetic-0',0,3)
    p1=raw/f"{first['batchId']}.manifest.json"
    _,roundtrip=read_batch(p1)
    assert roundtrip==sorted(records,key=lambda r:r['event']['eventId'])
    increment=root/'increment.duckdb'; rebuild=root/'rebuild.duckdb'
    def dbt(database,label,full=False):
        env=dict(os.environ,IEMS_ANALYTICS_DB=str(database))
        command=['dbt','build','--project-dir',str(Path(project).resolve()),'--profiles-dir',str(profiles),'--target-path',str(root/(label+'-target')),'--log-path',str(root/(label+'-logs'))]
        if full:
            command.append('--full-refresh')
        with (root/(label+'.log')).open('w') as log:
            subprocess.run(command,env=env,check=True,timeout=600,stdout=log,stderr=subprocess.STDOUT)
    c1=coverage(records,'initial')
    load([p1],increment,coverage_manifests=[c1]); dbt(increment,'initial')
    corrected=event(payment,2,'payment',{'orderId':order,'amount':'40.00','currency':'USD'})
    second=ingest([records[0],corrected],raw,'iems.reporting.snapshots.v2:synthetic-0',3,5,first)
    p2=raw/f"{second['batchId']}.manifest.json"
    c2=coverage([*records,corrected],'corrected')
    load([p1,p2],increment,coverage_manifests=[c1,c2]); dbt(increment,'increment')
    load([p1,p2],rebuild,coverage_manifests=[c1,c2]); dbt(rebuild,'rebuild',True)
    parity(increment,rebuild)
    import duckdb
    con=duckdb.connect(str(rebuild),read_only=True)
    row=con.execute("SELECT b.deposited_amount,q.remaining_quantity FROM order_balances b JOIN order_quantity_balances q USING(tenant_id,plant_id,order_id) WHERE q.uom='EA'").fetchone()
    assert str(row[0])=='40.000000000000' and str(row[1])=='7.000000000000'
    assert con.execute('SELECT count(*),sum(ordered_amount) FROM order_balances').fetchone()==(1,__import__('decimal').Decimal('100'))
    con.close()
    corrupt=json.loads(p2.read_text()); corrupt['count']+=1
    bad=raw/'corrupt.manifest.json'; bad.write_text(canonical(corrupt))
    try:
        read_batch(bad)
    except ValueError:
        pass
    else:
        raise AssertionError('Corrupt manifest accepted')
    result={'kind':'synthetic-local','incrementalRebuildParity':'PASS','rawRoundtrip':'PASS','depositPartialFulfillment':'PASS','manifestCorruption':'PASS','tenantId':tenant,'plantId':plant,'cloudAcceptance':'NOT_RUN','postgresRecovery':'NOT_RUN','at':now()}
    (root/'result.json').write_text(canonical(result),encoding='utf8')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('new_isolated_directory'); p.add_argument('--project',required=True)
    args=p.parse_args(); print(canonical(run(args.new_isolated_directory,args.project)))
