"""Explicit factory entrypoint: uvicorn server:app --factory is not used; use server:create."""
import json
import os
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import psycopg
from fastapi import Request as HttpRequest, HTTPException
from app import create_app
from catalog import Catalog
from projection import Projection, context


def create():
    authority=os.environ['IEMS_AUTHORITY_URL']
    parsed=urlparse(authority)
    if parsed.path!='/api/analytics/authority' or parsed.username or parsed.password or parsed.query or parsed.scheme not in ('http','https') or (parsed.scheme=='http' and parsed.hostname not in ('127.0.0.1','localhost','::1')):
        raise ValueError('Fixed private authority endpoint required')
    dsn=os.environ['IEMS_REPORTING_DSN']
    def connect():
        return psycopg.connect(dsn,connect_timeout=5,options='-c statement_timeout=10000 -c lock_timeout=3000')
    def authenticate(request:HttpRequest):
        cookie=request.headers.get('cookie','')
        if not cookie or len(cookie)>8192:
            raise HTTPException(401,detail='Session required')
        try:
            with urlopen(Request(authority,headers={'Cookie':cookie}),timeout=5) as response:
                data=response.read(65537)
                if len(data)>65536:
                    raise ValueError('Authority response oversized')
                return json.loads(data)['data']
        except Exception:
            raise HTTPException(403,detail='Fresh authority unavailable or denied')
    def audit(event):
        with connect() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    context(cur,event)
                    cur.execute('INSERT INTO reporting.export_audit(tenant_id,plant_id,user_id,dataset,run_id,lineage_hash,row_count,checksum,occurred_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)',[event['tenantId'],event['plantId'],event['userId'],event['dataset'],event['runId'],event['lineageHash'],event['count'],event['sha256'],event['at']])
    def no_source(e,cur):
        raise PermissionError('HTTP read process cannot consume source events')
    return create_app(Catalog(os.environ['IEMS_ANALYTICS_PUBLISH_ROOT'],audit),authenticate,Projection(connect,no_source))
