import re
import json
from uuid import UUID
from events import digest, validate, utc, now
from catalog import scope
from snapshots import exact, snapshot


def context(cursor,grant):
    cursor.execute("SELECT set_config('iems.tenant_id',%s,true),set_config('iems.plant_id',%s,true)",[grant['tenantId'],grant['plantId']])


BALANCES='''SELECT o.id::text AS order_id,o.currency,o.amount::text AS ordered_amount,
 p.amount::text AS deposited_amount,(o.amount-p.amount)::text AS unpaid_amount,
 (SELECT jsonb_agg(jsonb_build_object('uom',q.uom,'ordered_quantity',q.quantity::text,
 'fulfilled_quantity',f.quantity::text,'remaining_quantity',(q.quantity-f.quantity)::text) ORDER BY q.uom)
 FROM reporting.order_quantities q LEFT JOIN
 (SELECT tenant_id,plant_id,order_id,uom,sum(quantity) quantity FROM reporting.fulfillments WHERE NOT deleted GROUP BY tenant_id,plant_id,order_id,uom) f
 ON (f.tenant_id,f.plant_id,f.order_id,f.uom)=(q.tenant_id,q.plant_id,q.order_id,q.uom)
 WHERE (q.tenant_id,q.plant_id,q.order_id)=(o.tenant_id,o.plant_id,o.id)) AS quantities
 FROM reporting.orders o
 LEFT JOIN (SELECT tenant_id,plant_id,order_id,currency,sum(amount) amount FROM reporting.payments WHERE NOT deleted GROUP BY tenant_id,plant_id,order_id,currency) p
 ON (p.tenant_id,p.plant_id,p.order_id,p.currency)=(o.tenant_id,o.plant_id,o.id,o.currency)
 WHERE o.tenant_id=%s AND o.plant_id=%s AND NOT o.deleted AND o.id>%s::uuid ORDER BY o.id LIMIT %s'''


class Projection:
    def __init__(self,connect,authorize_source,max_age_seconds=86400):
        if not callable(connect) or not callable(authorize_source):
            raise ValueError('Explicit reporting connection and source authority required')
        self.connect,self.authorize_source=connect,authorize_source
        self.max_age_seconds=max_age_seconds

    def apply(self,record):
        e=snapshot(validate(record['event'])); receipt=record['receivedAt']; available=record['availableAt']
        if not utc(e['occurredAt'])<=utc(receipt)<=utc(available)<=utc(now()):
            raise ValueError('Invalid provenance')
        p=e['payload']; kind=p.get('resourceType')
        if kind not in ('order','payment','fulfillment'):
            raise ValueError('Explicit reporting event mapping required')
        if type(p.get('deleted',False)) is not bool:
            raise ValueError('Boolean tombstone required')
        fields={'order':['amount','currency'],'payment':['order_id','amount','currency'],'fulfillment':['order_id','quantity','uom']}[kind]
        values=[]
        for field in fields:
            value=p['orderId' if field=='order_id' else field]
            if field in ('amount','quantity'):
                value=exact(value)
            elif field=='order_id':
                UUID(value)
            elif field=='currency' and not re.fullmatch(r'[A-Z]{3}',value):
                raise ValueError('Currency required')
            elif field=='uom' and (not isinstance(value,str) or not 1<=len(value)<=32):
                raise ValueError('UOM required')
            values.append(value)
        key=[e['tenantId'],e['plantId'],e['aggregateId']]
        checksum=digest(e)
        with self.connect() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    grant=self.authorize_source(e,cur)
                    if grant['tenantId']!=e['tenantId'] or grant['plantId']!=e['plantId'] or grant['legalEntityId']!=p['legalEntityId']:
                        raise PermissionError('Source scope denied')
                    UUID(grant['tenantId']); UUID(grant['plantId'])
                    context(cur,grant)
                    cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",[':'.join(key)])
                    cur.execute('SELECT checksum FROM reporting.receipts WHERE tenant_id=%s AND plant_id=%s AND event_id=%s',[*key[:2],e['eventId']])
                    previous=cur.fetchone()
                    if previous:
                        if previous[0]!=checksum:
                            raise ValueError('Event identity conflict')
                        return 'duplicate'
                    cur.execute('SELECT version,resource_type,legal_entity_id::text FROM reporting.heads WHERE tenant_id=%s AND plant_id=%s AND aggregate_id=%s FOR UPDATE',key)
                    head=cur.fetchone()
                    if e['aggregateVersion']!=(head[0] if head else 0)+1 or (head and (head[1]!=kind or head[2]!=p['legalEntityId'])):
                        raise ValueError('Projection version gap or kind change')
                    if head:
                        cur.execute('SELECT available_at FROM reporting.receipts WHERE tenant_id=%s AND plant_id=%s AND aggregate_id=%s AND aggregate_version=%s',[*key,head[0]])
                        previous_time=cur.fetchone()
                        if not previous_time or utc(available)<previous_time[0]:
                            raise ValueError('Availability revision regressed')
                    if kind=='order':
                        cur.execute('SELECT id FROM reporting.orders WHERE tenant_id=%s AND plant_id=%s AND id=%s FOR UPDATE',key)
                        cur.execute('SELECT EXISTS(SELECT 1 FROM reporting.payments WHERE tenant_id=%s AND plant_id=%s AND order_id=%s AND NOT deleted AND (currency<>%s OR %s)) OR EXISTS(SELECT 1 FROM reporting.fulfillments WHERE tenant_id=%s AND plant_id=%s AND order_id=%s AND NOT deleted AND (NOT (uom=ANY(%s)) OR %s))', [*key,p['currency'],p['deleted'],*key,[q['uom'] for q in p['quantities']],p['deleted']])
                        if cur.fetchone()[0]:
                            raise ValueError('Active children conflict with order correction; replay children first')
                    if kind!='order':
                        cur.execute('SELECT currency FROM reporting.orders WHERE tenant_id=%s AND plant_id=%s AND id=%s AND NOT deleted FOR UPDATE',[*key[:2],p['orderId']])
                        parent=cur.fetchone()
                        if not parent or (kind=='payment' and parent[0]!=p['currency']):
                            raise ValueError('Missing parent or unit mismatch; replay after parent')
                        if kind=='fulfillment':
                            cur.execute('SELECT 1 FROM reporting.order_quantities WHERE tenant_id=%s AND plant_id=%s AND order_id=%s AND uom=%s',[*key[:2],p['orderId'],p['uom']])
                            if not cur.fetchone():
                                raise ValueError('Parent unit missing')
                    cur.execute('INSERT INTO reporting.heads VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(tenant_id,plant_id,aggregate_id) DO UPDATE SET version=excluded.version',[*key,e['aggregateVersion'],kind,p['legalEntityId']])
                    table={'order':'orders','payment':'payments','fulfillment':'fulfillments'}[kind]
                    columns=['tenant_id','plant_id','id',*fields,'deleted']
                    assignments=','.join(f'{field}=excluded.{field}' for field in [*fields,'deleted'])
                    cur.execute(f"INSERT INTO reporting.{table} ({','.join(columns)}) VALUES ({','.join(['%s']*len(columns))}) ON CONFLICT(tenant_id,plant_id,id) DO UPDATE SET {assignments}",[*key,*values,p.get('deleted',False)])
                    if kind=='order':
                        cur.execute('DELETE FROM reporting.order_quantities WHERE tenant_id=%s AND plant_id=%s AND order_id=%s',key)
                        for q in p['quantities']:
                            cur.execute('INSERT INTO reporting.order_quantities VALUES(%s,%s,%s,%s,%s)',[*key,q['uom'],exact(q['quantity'])])
                    cur.execute('SELECT amount,(SELECT coalesce(sum(amount),0) FROM reporting.payments p WHERE (p.tenant_id,p.plant_id,p.order_id)=(o.tenant_id,o.plant_id,o.id) AND NOT p.deleted) FROM reporting.orders o WHERE tenant_id=%s AND plant_id=%s AND id=%s',[*key[:2],key[2] if kind=='order' else p['orderId']])
                    monetary=cur.fetchone()
                    if monetary and monetary[1]>monetary[0]:
                        raise ValueError('Payment conservation failure')
                    cur.execute('SELECT EXISTS(SELECT 1 FROM reporting.order_quantities q JOIN (SELECT tenant_id,plant_id,order_id,uom,sum(quantity) AS quantity FROM reporting.fulfillments WHERE NOT deleted GROUP BY tenant_id,plant_id,order_id,uom) f USING(tenant_id,plant_id,order_id,uom) WHERE q.tenant_id=%s AND q.plant_id=%s AND q.order_id=%s AND f.quantity>q.quantity)',[*key[:2],key[2] if kind=='order' else p['orderId']])
                    if cur.fetchone()[0]:
                        raise ValueError('Quantity conservation failure')
                    cur.execute('INSERT INTO reporting.receipts VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)',[*key[:2],e['eventId'],e['aggregateId'],e['aggregateVersion'],checksum,e['occurredAt'],receipt,available,json.dumps(e)])
        return 'applied'

    def apply_coverage(self,manifest):
        checksum=digest({k:v for k,v in manifest.items() if k!='hash'})
        if checksum!=manifest.get('hash') or manifest.get('coverage')!='COMPLETE' or manifest.get('trustedZero') is not True or manifest.get('fence')!='single-snapshot-transaction' or manifest.get('quarantine')!=[] or manifest.get('unsupported')!=[]:
            raise ValueError('Complete authorized source coverage required')
        heads=manifest['snapshotHeads']
        if not isinstance(heads,list) or len(heads)>100000 or len({h['aggregateId'] for h in heads})!=len(heads):
            raise ValueError('Coverage bounds or identity conflict')
        UUID(manifest['runId']); UTC=utc(manifest['observedAt'])
        if UTC>utc(now()):
            raise ValueError('Unavailable coverage')
        with self.connect() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    grant=self.authorize_source(manifest,cur)
                    if any(grant[k]!=manifest[k] for k in ('tenantId','plantId','legalEntityId')):
                        raise PermissionError('Coverage source denied')
                    context(cur,grant)
                    for h in heads:
                        cur.execute('SELECT checksum FROM reporting.receipts WHERE tenant_id=%s AND plant_id=%s AND aggregate_id=%s AND aggregate_version=%s AND event_id=%s',[grant['tenantId'],grant['plantId'],h['aggregateId'],h['aggregateVersion'],h['eventId']])
                        row=cur.fetchone()
                        if not row or row[0]!=h['hash']:
                            raise ValueError('Coverage precedes verified snapshot replay')
                    cur.execute('SELECT checksum FROM reporting.source_coverage WHERE tenant_id=%s AND plant_id=%s AND run_id=%s',[grant['tenantId'],grant['plantId'],manifest['runId']])
                    prior=cur.fetchone()
                    if prior:
                        if prior[0]!=checksum:
                            raise ValueError('Coverage identity corruption')
                        return 'duplicate'
                    cur.execute('INSERT INTO reporting.source_coverage VALUES(%s,%s,%s,%s,%s::jsonb,%s)',[grant['tenantId'],grant['plantId'],manifest['runId'],manifest['observedAt'],json.dumps(manifest),checksum])
        return 'applied'

    def orders(self,grant,after=None,limit=100,explain=False):
        scope(grant,'analytics.read')
        if 'order-balances' not in grant.get('datasets',[]):
            raise PermissionError('Dataset denied')
        if type(limit) is not int or not 1<=limit<=1000:
            raise ValueError('Invalid limit')
        after=after or '00000000-0000-0000-0000-000000000000'; UUID(after)
        with self.connect() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                    context(cur,grant)
                    cur.execute(('EXPLAIN (FORMAT JSON) ' if explain else '')+BALANCES,[grant['tenantId'],grant['plantId'],after,limit+1])
                    if explain:
                        return cur.fetchone()[0]
                    rows=cur.fetchall(); columns=[c.name for c in cur.description]
                    data=[dict(zip(columns,row)) for row in rows[:limit]]
                    cur.execute('SELECT manifest FROM reporting.source_coverage WHERE tenant_id=%s AND plant_id=%s ORDER BY observed_at DESC LIMIT 1',[grant['tenantId'],grant['plantId']])
                    coverage=cur.fetchone(); coverage=coverage[0] if coverage else None
                    cur.execute('SELECT aggregate_id::text,version FROM reporting.heads WHERE tenant_id=%s AND plant_id=%s',[grant['tenantId'],grant['plantId']])
                    current=dict(cur.fetchall())
                    complete=bool(coverage and current=={h['aggregateId']:h['aggregateVersion'] for h in coverage['snapshotHeads']})
                    if complete:
                        for row in data:
                            if row['deposited_amount'] is None:
                                row['deposited_amount']='0'; row['unpaid_amount']=row['ordered_amount']
                            for q in row['quantities'] or []:
                                if q['fulfilled_quantity'] is None:
                                    q['fulfilled_quantity']='0'; q['remaining_quantity']=q['ordered_quantity']
                    else:
                        for row in data:
                            row['deposited_amount']=None; row['unpaid_amount']=None
                            for q in row['quantities'] or []:
                                q['fulfilled_quantity']=None; q['remaining_quantity']=None
                    for row in data:
                        row['coverage_status']='COMPLETE' if complete else 'INCOMPLETE'
                    cur.execute('SELECT max(available_at) FROM reporting.receipts WHERE tenant_id=%s AND plant_id=%s',[grant['tenantId'],grant['plantId']])
                    latest=cur.fetchone()[0]
                    if latest and not 0<=(utc(now())-latest).total_seconds()<=self.max_age_seconds:
                        raise ValueError('Reporting projection stale')
                    return {'data':data,'nextCursor':data[-1]['order_id'] if len(rows)>limit else None,'sourceAvailableAt':latest.isoformat() if latest else None,'sourceCoverageAt':coverage['observedAt'] if complete else None,'coverageStatus':('COMPLETE' if complete else 'INCOMPLETE') if data else 'NO_DATA','observedAt':now(),'authority':'projection'}
