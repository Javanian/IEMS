"""Strict wire contracts shared by offline projections; no source credentials."""
import hashlib
import json
import re
from datetime import datetime, timezone
from uuid import UUID


def canonical(value):
    def check(v):
        if isinstance(v, float):
            raise ValueError('Floating point payloads are forbidden')
        if type(v) is int and abs(v) > 9007199254740991:
            raise ValueError('Unsafe integer; encode exact values as strings')
        if isinstance(v, dict):
            for item in v.values():
                check(item)
        elif isinstance(v, list):
            for item in v:
                check(item)
    check(value)
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def utc(value):
    if not isinstance(value, str) or not value.endswith('Z'):
        raise ValueError('UTC timestamp required')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def validate(e):
    for key in ('eventId', 'tenantId', 'plantId', 'aggregateId'):
        UUID(e[key])
    if type(e['schemaVersion']) is not int or e['schemaVersion'] != 1 or type(e['aggregateVersion']) is not int or not 1 <= e['aggregateVersion'] <= 9007199254740991:
        raise ValueError('Unsupported event version')
    if not re.fullmatch(r'[A-Za-z][\w.-]{0,127}', e['type']) or not isinstance(e['payload'], dict):
        raise ValueError('Invalid event')
    utc(e['occurredAt'])
    if len(canonical(e).encode()) > 1024 * 1024:
        raise ValueError('Oversized event')
    return e
