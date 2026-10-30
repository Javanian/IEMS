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
    if kind not in ('order','payment','fulfillment','telemetry') or type(p.get('deleted',False)) is not bool:
        raise ValueError('Unsupported snapshot contract')
    if kind in ('order','payment'):
        exact(p['amount'])
        if not isinstance(p['currency'],str) or not re.fullmatch('[A-Z]{3}',p['currency']):
            raise ValueError('Currency required')
    if kind in ('order','fulfillment'):
        exact(p['quantity'])
        if not isinstance(p['uom'],str) or not 1<=len(p['uom'])<=32:
            raise ValueError('UOM required')
    if kind in ('payment','fulfillment'):
        UUID(p['orderId'])
    return event
