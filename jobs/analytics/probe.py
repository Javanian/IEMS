"""Deferred final-QA probe; creates only a new explicit synthetic directory."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from uuid import uuid4
from events import canonical, now
from raw import ingest, read_batch
from marts import load, parity


def run(root,project):
    root=Path(root).resolve()
    if root.exists():
        raise ValueError('Probe requires a NEW isolated directory; existing data is never reused or deleted')
    root.mkdir(parents=True,exist_ok=False)
    profiles=root/'profiles'; profiles.mkdir()
    (profiles/'profiles.yml').write_text('iems_reporting:\n  target: local\n  outputs:\n    local:\n      type: duckdb\n      path: "{{ env_var(\'IEMS_ANALYTICS_DB\') }}"\n      threads: 2\n',encoding='utf8')
    tenant,plant,order,payment,delivery=[str(uuid4()) for _ in range(5)]
    def event(aggregate,version,kind,payload):
        at=now()
        e={'eventId':str(uuid4()),'schemaVersion':1,'tenantId':tenant,'plantId':plant,'aggregateId':aggregate,'aggregateVersion':version,'type':kind+'.snapshot','occurredAt':at,'payload':{'resourceType':kind,'deleted':False,**payload}}
        return {'event':e,'receivedAt':at,'availableAt':at}
    records=[event(order,1,'order',{'amount':'100.00','currency':'USD','quantity':'10.000','uom':'EA'}),event(payment,1,'payment',{'orderId':order,'amount':'25.00','currency':'USD'}),event(delivery,1,'fulfillment',{'orderId':order,'quantity':'3.000','uom':'EA'})]
    raw=root/'raw'
    first=ingest(records,raw,'synthetic:0',0,3)
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
    load([p1],increment); dbt(increment,'initial')
    corrected=event(payment,2,'payment',{'orderId':order,'amount':'40.00','currency':'USD'})
    second=ingest([records[0],corrected],raw,'synthetic:0',3,5,first)
    p2=raw/f"{second['batchId']}.manifest.json"
    load([p1,p2],increment); dbt(increment,'increment')
    load([p1,p2],rebuild); dbt(rebuild,'rebuild',True)
    parity(increment,rebuild)
    import duckdb
    con=duckdb.connect(str(rebuild),read_only=True)
    row=con.execute('SELECT deposited_amount,remaining_quantity FROM order_balances').fetchone()
    assert str(row[0])=='40.000000000000' and str(row[1])=='7.000000000000'
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
