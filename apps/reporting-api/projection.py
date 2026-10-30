import re
from uuid import UUID
from events import digest, validate, utc, now
from catalog import scope
from snapshots import exact


def context(cursor,grant):
    cursor.execute("SELECT set_config('iems.tenant_id',%s,true),set_config('iems.plant_id',%s,true)",[grant['tenantId'],grant['plantId']])


BALANCES='''SELECT o.id::text AS order_id,o.currency,o.uom,o.amount::text AS ordered_amount,o.quantity::text AS ordered_quantity,
 coalesce(p.amount,0)::text AS deposited_amount,(o.amount-coalesce(p.amount,0))::text AS unpaid_amount,
 coalesce(f.quantity,0)::text AS fulfilled_quantity,(o.quantity-coalesce(f.quantity,0))::text AS remaining_quantity
 FROM reporting.orders o
 LEFT JOIN (SELECT tenant_id,plant_id,order_id,currency,sum(amount) amount FROM reporting.payments WHERE NOT deleted GROUP BY tenant_id,plant_id,order_id,currency) p
 ON (p.tenant_id,p.plant_id,p.order_id,p.currency)=(o.tenant_id,o.plant_id,o.id,o.currency)
 LEFT JOIN (SELECT tenant_id,plant_id,order_id,uom,sum(quantity) quantity FROM reporting.fulfillments WHERE NOT deleted GROUP BY tenant_id,plant_id,order_id,uom) f
 ON (f.tenant_id,f.plant_id,f.order_id,f.uom)=(o.tenant_id,o.plant_id,o.id,o.uom)
 WHERE o.tenant_id=%s AND o.plant_id=%s AND NOT o.deleted AND o.id>%s::uuid ORDER BY o.id LIMIT %s'''


class Projection:
    def __init__(self,connect,authorize_source,max_age_seconds=86400):
        if not callable(connect) or not callable(authorize_source):
            raise ValueError('Explicit reporting connection and source authority required')
        self.connect,self.authorize_source=connect,authorize_source
        self.max_age_seconds=max_age_seconds

    def apply(self,record):
        e=validate(record['event']); receipt=record['receivedAt']; available=record['availableAt']
        if not utc(e['occurredAt'])<=utc(receipt)<=utc(available)<=utc(now()):
            raise ValueError('Invalid provenance')
        p=e['payload']; kind=p.get('resourceType')
        if kind not in ('order','payment','fulfillment'):
            raise ValueError('Explicit reporting event mapping required')
        if type(p.get('deleted',False)) is not bool:
            raise ValueError('Boolean tombstone required')
        fields={'order':['amount','currency','quantity','uom'],'payment':['order_id','amount','currency'],'fulfillment':['order_id','quantity','uom']}[kind]
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
                    if grant['tenantId']!=e['tenantId'] or grant['plantId']!=e['plantId']:
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
                    cur.execute('SELECT version,resource_type FROM reporting.heads WHERE tenant_id=%s AND plant_id=%s AND aggregate_id=%s FOR UPDATE',key)
                    head=cur.fetchone()
                    if e['aggregateVersion']!=(head[0] if head else 0)+1 or (head and head[1]!=kind):
                        raise ValueError('Projection version gap or kind change')
                    if head:
                        cur.execute('SELECT available_at FROM reporting.receipts WHERE tenant_id=%s AND plant_id=%s AND aggregate_id=%s AND aggregate_version=%s',[*key,head[0]])
                        previous_time=cur.fetchone()
                        if not previous_time or utc(available)<previous_time[0]:
                            raise ValueError('Availability revision regressed')
                    if kind=='order':
                        cur.execute('SELECT id FROM reporting.orders WHERE tenant_id=%s AND plant_id=%s AND id=%s FOR UPDATE',key)
                        cur.execute('SELECT EXISTS(SELECT 1 FROM reporting.payments WHERE tenant_id=%s AND plant_id=%s AND order_id=%s AND NOT deleted AND (currency<>%s OR %s)) OR EXISTS(SELECT 1 FROM reporting.fulfillments WHERE tenant_id=%s AND plant_id=%s AND order_id=%s AND NOT deleted AND (uom<>%s OR %s))',[*key,p['currency'],p.get('deleted',False),*key,p['uom'],p.get('deleted',False)])
                        if cur.fetchone()[0]:
                            raise ValueError('Active children conflict with order correction; replay children first')
                    if kind!='order':
                        cur.execute('SELECT currency,uom FROM reporting.orders WHERE tenant_id=%s AND plant_id=%s AND id=%s AND NOT deleted FOR SHARE',[*key[:2],p['orderId']])
                        parent=cur.fetchone()
                        if not parent or (kind=='payment' and parent[0]!=p['currency']) or (kind=='fulfillment' and parent[1]!=p['uom']):
                            raise ValueError('Missing parent or unit mismatch; replay after parent')
                    cur.execute('INSERT INTO reporting.heads VALUES(%s,%s,%s,%s,%s) ON CONFLICT(tenant_id,plant_id,aggregate_id) DO UPDATE SET version=excluded.version',[*key,e['aggregateVersion'],kind])
                    table={'order':'orders','payment':'payments','fulfillment':'fulfillments'}[kind]
                    columns=['tenant_id','plant_id','id',*fields,'deleted']
                    assignments=','.join(f'{field}=excluded.{field}' for field in [*fields,'deleted'])
                    cur.execute(f"INSERT INTO reporting.{table} ({','.join(columns)}) VALUES ({','.join(['%s']*len(columns))}) ON CONFLICT(tenant_id,plant_id,id) DO UPDATE SET {assignments}",[*key,*values,p.get('deleted',False)])
                    cur.execute('INSERT INTO reporting.receipts VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)',[*key[:2],e['eventId'],e['aggregateId'],e['aggregateVersion'],checksum,e['occurredAt'],receipt,available])
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
                    cur.execute('SELECT max(available_at) FROM reporting.receipts WHERE tenant_id=%s AND plant_id=%s',[grant['tenantId'],grant['plantId']])
                    latest=cur.fetchone()[0]
                    if latest and not 0<=(utc(now())-latest).total_seconds()<=self.max_age_seconds:
                        raise ValueError('Reporting projection stale')
                    return {'data':data,'nextCursor':data[-1]['order_id'] if len(rows)>limit else None,'sourceAvailableAt':latest.isoformat() if latest else None,'observedAt':now(),'authority':'projection'}
