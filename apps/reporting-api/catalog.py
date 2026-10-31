"""Governed, scoped reads of immutable DuckDB publications."""
import csv
import hashlib
import io
import json
from pathlib import Path
from uuid import UUID
from publish import verify_publication
from events import now, utc

DATASETS = {
    'order-balances': {'table':'order_balances', 'columns':['order_id','currency','ordered_amount','deposited_amount','unpaid_amount','quantities','coverage_status'], 'description':'One monetary row per order with quantities by UOM and reconciled source coverage.'},
    'resource-history': {'table':'resource_history', 'columns':['event_id','aggregate_id','aggregate_version','resource_type','occurred_at','received_at','available_at','valid_from','valid_to','known_until','deleted'], 'description':'Versioned resource history with source and availability times.'},
}


def scope(grant, action):
    for key in ('tenantId','plantId','userId'):
        UUID(grant[key])
    if action not in grant.get('actions', []):
        raise PermissionError('Scope denied')


class Catalog:
    def __init__(self, root, audit, max_age_seconds=86400):
        if not callable(audit):
            raise ValueError('Durable export audit required')
        self.root, self.audit, self.max_age = Path(root).resolve(), audit, max_age_seconds

    def publications(self):
        items = []
        for path in self.root.glob('*.trusted.json'):
            item = json.loads(path.read_text())
            verify_publication(self.root, item)
            items.append(item)
        return sorted(items, key=lambda m:m['completedAt'], reverse=True)

    def listing(self, grant):
        scope(grant, 'analytics.read')
        return [{'id':k,'description':v['description'],'authority':'read-only projection'} for k,v in DATASETS.items() if k in grant.get('datasets', [])]

    def read(self, grant, dataset, run_id=None, after=None, limit=100):
        import duckdb
        scope(grant, 'analytics.read')
        if dataset not in DATASETS or dataset not in grant.get('datasets', []):
            raise PermissionError('Dataset denied')
        if type(limit) is not int or not 1 <= limit <= 10000:
            raise ValueError('Invalid limit')
        if after:
            UUID(after)
        items = self.publications()
        item = next((p for p in items if p['runId'] == run_id), None) if run_id else next(iter(items), None)
        if item is None:
            raise FileNotFoundError('No trusted publication')
        if (utc(now())-utc(item['completedAt'])).total_seconds() > self.max_age:
            raise ValueError('Dataset stale; request a successful refresh')
        path = verify_publication(self.root, item)
        definition=DATASETS[dataset]; key=definition['columns'][0]
        con=duckdb.connect(str(path),read_only=True)
        try:
            con.execute("SET memory_limit='256MB'")
            rows=con.execute(f"SELECT {','.join(definition['columns'])} FROM {definition['table']} WHERE tenant_id=? AND plant_id=? AND {key}>? ORDER BY {key} LIMIT ?", [grant['tenantId'],grant['plantId'],after or '',limit+1]).fetchall()
        finally:
            con.close()
        output=[{k:(v.isoformat() if hasattr(v,'isoformat') else str(v) if v is not None and not isinstance(v,(bool,int,str)) else v) for k,v in zip(definition['columns'],row)} for row in rows[:limit]]
        return {'data':output,'nextCursor':output[-1][key] if len(rows)>limit else None,'runId':item['runId'],'lineageHash':item['hash'],'publishedAt':item['completedAt'],'observedAt':now(),'authority':'projection'}

    def export(self, grant, dataset, run_id):
        scope(grant, 'analytics.export')
        result=self.read(grant,dataset,run_id,limit=10000)
        if result['nextCursor']:
            raise ValueError('Export exceeds 10000 rows; request a bounded dataset')
        output=io.StringIO(newline=''); writer=csv.writer(output)
        columns=DATASETS[dataset]['columns']; writer.writerow(columns)
        for row in result['data']:
            values=[]
            for column in columns:
                value='' if row[column] is None else str(row[column])
                values.append("'"+value if value.lstrip().startswith(('=','+','-','@','\t','\r')) else value)
            writer.writerow(values)
        body=output.getvalue().encode('utf-8')
        self.audit({'kind':'analytics.export','userId':grant['userId'],'tenantId':grant['tenantId'],'plantId':grant['plantId'],'dataset':dataset,'runId':result['runId'],'lineageHash':result['lineageHash'],'count':len(result['data']),'sha256':hashlib.sha256(body).hexdigest(),'at':now()})
        return body,result
