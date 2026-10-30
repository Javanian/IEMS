import re
from decimal import Decimal
from uuid import UUID


def exact(value):
    if not isinstance(value,str) or not re.fullmatch(r'(0|[1-9]\d*)(\.\d{1,12})?',value):
        raise ValueError('Nonnegative decimal string with <=12 places required')
    number=Decimal(value)
    if number>=Decimal('1e26'):
        raise ValueError('Decimal exceeds numeric(38,12)')
    return number


def snapshot(event):
    p=event['payload']; kind=p.get('resourceType')
    if event.get('schemaVersion') != 2 or event.get('type') != 'reporting.snapshot.v2':
        raise ValueError('Explicit v2 snapshot stream required; legacy domain metadata is not a snapshot')
    if kind not in ('order','payment','fulfillment') or type(p.get('deleted')) is not bool or type(p.get('baseline')) is not bool:
        raise ValueError('Unsupported snapshot contract')
    UUID(p['legalEntityId']); UUID(p['resourceId'])
    if p['resourceId'] != event['aggregateId']:
        raise ValueError('Resource identity conflict')
    source=p['source']
    if type(source['mappingVersion']) is not int or source['mappingVersion'] != 1 or source['collection'] not in ('salesOrders','fulfillmentKeys','fulfillmentPayments','fulfillmentShipments') or not re.fullmatch('[a-f0-9]{64}',source['hash']):
        raise ValueError('Source evidence required')
    UUID(source['id'])
    if not isinstance(source.get('eventIds'),list) or len(source['eventIds'])>100 or type(source.get('version')) not in (str,int) or not 1<=len(str(source['version']))<=128 or (type(source['version']) is int and not 0<=source['version']<=9007199254740991):
        raise ValueError('Source identity required')
    for event_id in source['eventIds']:
        UUID(event_id)
    if p['deleted'] and (not isinstance(source.get('deleteReason'),str) or not source['deleteReason'].strip()):
        raise ValueError('Explicit source tombstone reason required')
    if kind in ('order','payment'):
        exact(p['amount'])
        if not isinstance(p['currency'],str) or not re.fullmatch('[A-Z]{3}',p['currency']):
            raise ValueError('Currency required')
    quantities=p['quantities'] if kind=='order' else [p] if kind=='fulfillment' else []
    if not isinstance(quantities,list) or (kind=='order' and not 1<=len(quantities)<=100):
        raise ValueError('Quantities by UOM required')
    seen=set()
    for q in quantities:
        exact(q['quantity'])
        if not isinstance(q['uom'],str) or not re.fullmatch('[A-Z][A-Z0-9_]{0,31}',q['uom']) or q['uom'] in seen:
            raise ValueError('UOM required')
        seen.add(q['uom'])
    if kind in ('payment','fulfillment'):
        UUID(p['orderId'])
    return event
