"""Bounded, replayable raw-event backfill into an Iceberg projection table."""
import json
import re
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'analytics'))
from events import canonical, digest, now
from raw import read_batch
from publish import atomic_json


def identifier(value):
    if not re.fullmatch(r'[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*',value):
        raise ValueError('Catalog.namespace.table required')
    return value


def backfill(spark, table, manifests, receipt_path):
    from pyspark.sql import functions as F
    from pyspark.sql.types import StructType, StructField, StringType, LongType
    table=identifier(table)
    if not 1<=len(manifests)<=100:
        raise ValueError('At most 100 manifests per backfill')
    receipt=Path(receipt_path)
    identity=digest([json.loads(Path(p).read_text()) for p in manifests])
    if receipt.exists() and json.loads(receipt.read_text())['inputHash']!=identity:
        raise ValueError('Backfill identity conflict')
    spark.conf.set('spark.sql.shuffle.partitions','4')
    spark.conf.set('spark.sql.adaptive.enabled','true')
    spark.sql(f'''CREATE TABLE IF NOT EXISTS {table} (
       event_id STRING, tenant_id STRING, plant_id STRING, aggregate_id STRING,
       aggregate_version BIGINT, occurred_at STRING, received_at STRING,
       available_at STRING, checksum STRING, envelope STRING)
       USING iceberg PARTITIONED BY (tenant_id, plant_id)
       TBLPROPERTIES ('format-version'='2','write.target-file-size-bytes'='67108864')''')
    schema=StructType([StructField(k,LongType() if k=='aggregate_version' else StringType(),False) for k in ['event_id','tenant_id','plant_id','aggregate_id','aggregate_version','occurred_at','received_at','available_at','checksum','envelope']])
    count=0; heads={}
    for path in manifests:
        m,records=read_batch(path)
        previous=heads.get(m['stream'])
        if previous and (m['previous']!=previous['hash'] or m['start']!=previous['end']):
            raise ValueError('Backfill cursor gap')
        heads[m['stream']]=m
        rows=[]
        for r in records:
            e=r['event']
            rows.append((e['eventId'],e['tenantId'],e['plantId'],e['aggregateId'],e['aggregateVersion'],e['occurredAt'],r['receivedAt'],r['availableAt'],digest(e),canonical(e)))
        count+=len(rows)
        if count>1000000:
            raise ValueError('Split backfill into bounded runs')
        if not rows:
            continue
        frame=spark.createDataFrame(rows,schema).repartition(4)
        existing=spark.table(table)
        conflicts=frame.alias('s').join(existing.alias('t'),F.col('s.event_id')==F.col('t.event_id')).where((F.col('s.checksum')!=F.col('t.checksum')) | (F.col('s.tenant_id')!=F.col('t.tenant_id')) | (F.col('s.plant_id')!=F.col('t.plant_id')))
        if conflicts.limit(1).count():
            raise ValueError('Iceberg replay corruption')
        frame.createOrReplaceTempView('iems_backfill_candidate')
        spark.sql(f'''MERGE INTO {table} t USING iems_backfill_candidate s
          ON t.event_id=s.event_id
          WHEN NOT MATCHED THEN INSERT *''')
        # A commit with an uncertain client response is replayed through the same merge.
        sink=spark.table(table).select(*frame.columns)
        if frame.exceptAll(sink).limit(1).count():
            raise ValueError('Backfill source-to-sink mismatch')
        duplicates=sink.join(frame.select('event_id'),['event_id']).groupBy('event_id').count().where('count<>1')
        if duplicates.limit(1).count():
            raise ValueError('Concurrent duplicate event IDs; stop publication')
    snapshot=spark.sql(f'SELECT snapshot_id FROM {table}.snapshots ORDER BY committed_at DESC LIMIT 1').collect()
    result={'version':1,'inputHash':identity,'table':table,'snapshotId':str(snapshot[0][0]) if snapshot else None,'rowsRead':count,'heads':{s:m['hash'] for s,m in heads.items()},'completedAt':now(),'authority':'projection'}
    result['hash']=digest(result)
    atomic_json(receipt,result)
    return result


def compact(spark,table,tenant_id,plant_id):
    from uuid import UUID
    table=identifier(table); UUID(tenant_id); UUID(plant_id)
    catalog,namespace,name=table.split('.')
    predicate=f"tenant_id = '{tenant_id}' AND plant_id = '{plant_id}'"
    escaped=predicate.replace("'","''")
    return spark.sql(f"CALL {catalog}.system.rewrite_data_files(table => '{namespace}.{name}', where => '{escaped}', options => map('target-file-size-bytes','67108864','max-concurrent-file-group-rewrites','1'))").collect()
