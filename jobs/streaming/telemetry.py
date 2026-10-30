"""Flink 1.20 keyed event-time correction windows with checkpointed state."""
import json
import sys
from decimal import Decimal, InvalidOperation, localcontext
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'analytics'))
from events import canonical, digest, utc, validate
from pyflink.common import Types, WatermarkStrategy, Duration
from pyflink.common.watermark_strategy import TimestampAssigner
from pyflink.datastream import KeyedProcessFunction, CheckpointingMode
from pyflink.datastream.state import MapStateDescriptor, ValueStateDescriptor

WINDOW_MS=60000
LATENESS_MS=300000
MAX_SAMPLES=5000
MAX_RECEIPTS=20000


def decode(value):
    e=validate(json.loads(value))
    if e['type'] != 'telemetry.snapshot' or e['payload'].get('resourceType') != 'telemetry':
        raise ValueError('Unsupported telemetry event')
    value=e['payload'].get('value')
    if not isinstance(value,str) or len(value)>48:
        raise ValueError('Decimal string required')
    try:
        number=Decimal(value)
        if not number.is_finite() or abs(number)>Decimal('1000000000000') or number.as_tuple().exponent < -12:
            raise ValueError('Telemetry precision out of bounds')
    except InvalidOperation as error:
        raise ValueError('Invalid telemetry value') from error
    if not isinstance(e['payload'].get('uom'),str) or not 1<=len(e['payload']['uom'])<=32:
        raise ValueError('UOM required')
    return e


def timestamp(e):
    return int(utc(e['occurredAt']).timestamp()*1000)


class EventTime(TimestampAssigner):
    def extract_timestamp(self,value,record_timestamp):
        return timestamp(decode(value))


class Corrections(KeyedProcessFunction):
    def open(self,context):
        self.samples=context.get_map_state(MapStateDescriptor('samples-v1',Types.STRING(),Types.STRING()))
        self.receipts=context.get_map_state(MapStateDescriptor('receipts-v1',Types.STRING(),Types.STRING()))
        self.count=context.get_state(ValueStateDescriptor('sample-count-v1',Types.INT()))
        self.receipt_count=context.get_state(ValueStateDescriptor('receipt-count-v1',Types.INT()))
        self.revision=context.get_state(ValueStateDescriptor('output-revision-v1',Types.LONG()))
        self.emitted=context.get_state(ValueStateDescriptor('emitted-v1',Types.BOOLEAN()))

    def projection(self,key):
        values=[json.loads(v) for _,v in self.samples.items()]
        with localcontext() as decimal_context:
            decimal_context.prec=50
            total=sum((Decimal(v['value']) for v in values if not v['deleted']),Decimal(0))
        count=sum(not v['deleted'] for v in values)
        revision=(self.revision.value() or 0)+1; self.revision.update(revision)
        return canonical({'kind':'projection','key':key,'revision':revision,'count':count,'sum':str(total),'windowMs':WINDOW_MS,'authority':'projection'})

    def process_element(self,value,ctx):
        e=decode(value); time=timestamp(e); end=(time//WINDOW_MS+1)*WINDOW_MS
        if ctx.timer_service().current_watermark()>=end+LATENESS_MS:
            yield canonical({'kind':'quarantine','eventId':e['eventId'],'reason':'BEYOND_LATENESS','requires':'bounded batch correction'})
            return
        checksum=digest(e); old_hash=self.receipts.get(e['eventId'])
        if old_hash:
            if old_hash!=checksum:
                raise ValueError('Event identity conflict')
            return
        previous=self.samples.get(e['aggregateId']); old=json.loads(previous) if previous else None
        if e['aggregateVersion']!=(old['version'] if old else 0)+1:
            raise ValueError('Telemetry version gap; replay required')
        if (not old and (self.count.value() or 0)>=MAX_SAMPLES) or (self.receipt_count.value() or 0)>=MAX_RECEIPTS:
            raise ValueError('State bound exceeded; repartition source')
        self.samples.put(e['aggregateId'],canonical({'version':e['aggregateVersion'],'value':e['payload']['value'],'deleted':e['payload'].get('deleted',False)}))
        self.receipts.put(e['eventId'],checksum)
        self.receipt_count.update((self.receipt_count.value() or 0)+1)
        if not old:
            self.count.update((self.count.value() or 0)+1)
        ctx.timer_service().register_event_time_timer(end)
        ctx.timer_service().register_event_time_timer(end+LATENESS_MS)
        if self.emitted.value():
            yield self.projection(ctx.get_current_key())

    def on_timer(self,time,ctx):
        if time%WINDOW_MS==0 and not self.emitted.value():
            self.emitted.update(True)
            yield self.projection(ctx.get_current_key())
        else:
            self.samples.clear(); self.receipts.clear(); self.count.clear()
            self.receipt_count.clear(); self.revision.clear(); self.emitted.clear()


def attach(env,source):
    env.enable_checkpointing(30000,CheckpointingMode.EXACTLY_ONCE)
    config=env.get_checkpoint_config(); config.set_checkpoint_timeout(120000)
    config.set_max_concurrent_checkpoints(1)
    strategy=WatermarkStrategy.for_bounded_out_of_orderness(Duration.of_seconds(30)).with_timestamp_assigner(EventTime()).with_idleness(Duration.of_minutes(1))
    def key(value):
        e=decode(value)
        return ':'.join([e['tenantId'],e['plantId'],e['payload']['uom'],str(timestamp(e)//WINDOW_MS)])
    return source.assign_timestamps_and_watermarks(strategy).key_by(key,key_type=Types.STRING()).process(Corrections(),output_type=Types.STRING()).uid('iems-telemetry-v1')
