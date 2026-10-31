"""Fresh marker-owned PostgreSQL only; never accepts a DSN or application env file."""
import argparse
from copy import deepcopy
from decimal import Decimal
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from uuid import uuid4

import duckdb
import psycopg

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'jobs/analytics'))
from events import digest, now
from raw import read_batch
from projection import Projection, context


def run(root, evidence, pg_bin):
    root, evidence, pg_bin = Path(root).resolve(), Path(evidence).resolve(), Path(pg_bin).resolve()
    scratch = Path(os.environ['PAPERCLIP_RUN_SCRATCH_DIR']).resolve()
    assert scratch in root.parents and not root.exists(), 'New run scratch target required before connection/DDL'
    assert evidence.is_dir() and (evidence / 'result.json').is_file(), 'Completed native dbt evidence required'
    root.mkdir()
    owner = {'runId': os.environ['PAPERCLIP_RUN_ID'], 'root': str(root), 'kind': 'synthetic-reporting'}
    (root / 'owner.json').write_text(json.dumps(owner))
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    assert port != 5432
    result = {'kind': 'NATIVE_ISOLATED_POSTGRES', 'checks': {}, 'port': port, 'dataDirectory': str(root / 'data')}

    def command(name, *args):
        with (root / (name + '.log')).open('a') as log:
            subprocess.run([str(pg_bin / (name + '.exe')), *args], check=True, timeout=60,
                           stdout=log, stderr=subprocess.STDOUT, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))

    def connect(user='test_writer'):
        assert json.loads((root / 'owner.json').read_text()) == owner
        return psycopg.connect(host='127.0.0.1', port=port, user=user, dbname='postgres',
                              connect_timeout=5, options='-c statement_timeout=5000 -c lock_timeout=2000')

    tables = ['heads', 'receipts', 'orders', 'order_quantities', 'payments', 'fulfillments', 'source_coverage']

    def state():
        with connect('test_owner') as conn:
            return {t: conn.execute('SELECT * FROM reporting.' + t + ' ORDER BY 1,2,3').fetchall() for t in tables}

    def rejected(fn, error=ValueError):
        before = state()
        try:
            fn()
        except error:
            pass
        else:
            raise AssertionError('Expected rejection')
        assert state() == before, 'Rejected operation changed projection/receipts'

    command('initdb', '-D', str(root / 'data'), '-U', 'test_owner', '--auth=trust', '--locale=C', '--encoding=UTF8')
    started = False
    try:
        command('pg_ctl', '-D', str(root / 'data'), '-l', str(root / 'server.log'), '-o', f'-h 127.0.0.1 -p {port}', '-w', 'start')
        started = True
        with connect('test_owner') as conn:
            assert Path(conn.execute('SHOW data_directory').fetchone()[0]).resolve() == root / 'data'
            result['serverVersion'] = conn.execute('SHOW server_version').fetchone()[0]
            result['postmasterPid'] = int((root / 'data/postmaster.pid').read_text().splitlines()[0])
            conn.execute((REPO / 'database/migrations/reporting/001_projection.sql').read_text())
            for role in ('test_writer', 'test_reader'):
                conn.execute(f'CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS')
                conn.execute(f'GRANT USAGE ON SCHEMA reporting TO {role}')
            conn.execute('GRANT SELECT ON ' + ','.join('reporting.' + t for t in tables) + ' TO test_reader')
            conn.execute('GRANT SELECT,INSERT ON reporting.receipts,reporting.source_coverage,reporting.order_quantities TO test_writer')
            conn.execute('GRANT SELECT,INSERT,UPDATE ON reporting.heads,reporting.orders,reporting.payments,reporting.fulfillments TO test_writer')
            conn.execute('GRANT DELETE ON reporting.order_quantities TO test_writer')
        result['checks']['migration_and_exact_documented_grants'] = 'PASS'
        records = []
        for manifest in (evidence / 'raw').glob('*.manifest.json'):
            if manifest.name == 'corrupt.manifest.json':
                continue
            _, batch = read_batch(manifest)
            records.extend(batch)
        unique = {r['event']['eventId']: r for r in records}
        records = sorted(unique.values(), key=lambda r: (r['event']['aggregateVersion'], r['event']['payload']['resourceType'] != 'order'))
        order = next(r for r in records if r['event']['payload']['resourceType'] == 'order')
        e = order['event']
        grant = {'tenantId': e['tenantId'], 'plantId': e['plantId'], 'legalEntityId': e['payload']['legalEntityId'],
                 'userId': str(uuid4()), 'actions': ['analytics.read'], 'datasets': ['order-balances']}
        projection = Projection(connect, lambda event, cursor: grant)
        for record in records:
            assert projection.apply(record) == 'applied'
        before = state()
        for record in records:
            assert Projection(connect, lambda event, cursor: grant).apply(record) == 'duplicate'
        assert state() == before
        result['checks']['first_order_children_update_restart_replay'] = 'PASS'
        reader = Projection(lambda: connect('test_reader'), lambda *args: (_ for _ in ()).throw(PermissionError()))
        assert reader.orders(grant)['data'][0]['deposited_amount'] is None
        coverage = json.loads((evidence / 'corrected.coverage.json').read_text())
        assert projection.apply_coverage(coverage) == 'applied'
        assert projection.apply_coverage(coverage) == 'duplicate'
        row = reader.orders(grant)['data'][0]
        with duckdb.connect(str(evidence / 'rebuild.duckdb'), read_only=True) as con:
            money = con.execute('SELECT ordered_amount,deposited_amount,unpaid_amount FROM order_balances').fetchone()
            quantities = con.execute('SELECT uom,ordered_quantity,fulfilled_quantity,remaining_quantity FROM order_quantity_balances ORDER BY uom').fetchall()
        assert tuple(Decimal(row[k]) for k in ('ordered_amount', 'deposited_amount', 'unpaid_amount')) == money
        assert [(q['uom'], *(Decimal(q[k]) for k in ('ordered_quantity', 'fulfilled_quantity', 'remaining_quantity'))) for q in row['quantities']] == quantities
        result['checks']['source_raw_dbt_sql_exact_mixed_uom_parity_and_coverage'] = 'PASS'

        def revision(record, version, **changes):
            r = deepcopy(record)
            r['event'].update(eventId=str(uuid4()), aggregateVersion=version, occurredAt=now())
            r['event']['payload'].update(changes)
            source = r['event']['payload']['source']
            source.update(version=version, sourceOccurredAt=r['event']['occurredAt'], hash=digest(changes))
            if changes.get('deleted'):
                source['deleteReason'] = 'synthetic source tombstone'
            r.update(receivedAt=now(), availableAt=now())
            return r

        updated = revision(order, 2, amount='9007199254740993.99', quantities=[{'uom': 'EA', 'quantity': '20.125000000001'}])
        assert projection.apply(updated) == 'applied'
        assert reader.orders(grant)['data'][0]['coverage_status'] == 'INCOMPLETE'
        with connect() as conn:
            context(conn.cursor(), grant)
            assert conn.execute('SELECT uom,quantity FROM reporting.order_quantities').fetchall() == [('EA', Decimal('20.125000000001'))]
            assert conn.execute('SELECT amount FROM reporting.orders').fetchone()[0] == Decimal('9007199254740993.99')
        rejected(lambda: projection.apply(revision(updated, 3, quantities=[{'uom': 'EA', 'quantity': '1'}])))
        rejected(lambda: projection.apply(revision(updated, 4)))
        bad = deepcopy(order); bad['event']['payload']['amount'] = '101'
        rejected(lambda: projection.apply(bad))
        denied = Projection(connect, lambda event, cursor: {**grant, 'plantId': str(uuid4())})
        rejected(lambda: denied.apply(updated), PermissionError)
        result['checks']['quantity_replacement_removed_uom_conservation_rollback_gap_corruption_authority'] = 'PASS'
        with connect() as conn:
            context(conn.cursor(), grant)
            assert conn.execute('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone() == (False, False)
            for table in ('heads', 'receipts', 'orders', 'payments', 'fulfillments', 'source_coverage'):
                assert not conn.execute('SELECT has_table_privilege(current_user,%s,\'DELETE\')', ['reporting.' + table]).fetchone()[0]
            assert not conn.execute("SELECT has_table_privilege(current_user,'reporting.receipts','UPDATE')").fetchone()[0]
        result['checks']['writer_no_broad_delete_no_receipt_update_no_bypass'] = 'PASS'

        def fk_failure():
            with connect() as conn:
                context(conn.cursor(), grant)
                conn.execute('INSERT INTO reporting.order_quantities VALUES(%s,%s,%s,%s,1)', [grant['tenantId'], grant['plantId'], str(uuid4()), 'EA'])
        rejected(fk_failure, psycopg.errors.ForeignKeyViolation)
        for changes in ({'tenantId': str(uuid4())}, {'plantId': str(uuid4())}):
            with connect('test_reader') as conn:
                context(conn.cursor(), {**grant, **changes})
                assert conn.execute('SELECT count(*) FROM reporting.orders').fetchone()[0] == 0
            def rls_failure():
                with connect() as conn:
                    context(conn.cursor(), {**grant, **changes})
                    conn.execute('INSERT INTO reporting.order_quantities VALUES(%s,%s,%s,%s,1)', [grant['tenantId'], grant['plantId'], e['aggregateId'], 'KG'])
            rejected(rls_failure, psycopg.errors.InsufficientPrivilege)
        with connect('test_reader') as conn:
            context(conn.cursor(), grant)
            assert conn.execute('SELECT count(*) FROM reporting.orders').fetchone()[0] == 1
        def reader_write():
            with connect('test_reader') as conn:
                context(conn.cursor(), grant)
                conn.execute('UPDATE reporting.orders SET amount=0')
        rejected(reader_write, psycopg.errors.InsufficientPrivilege)
        result['checks']['fk_tenant_and_plant_rls_reader_denial'] = 'PASS'
        before = state()
        interrupted = connect()
        try:
            context(interrupted.cursor(), grant)
            interrupted.execute('UPDATE reporting.orders SET amount=999')
            with connect('test_owner') as admin:
                assert admin.execute('SELECT pg_terminate_backend(%s)', [interrupted.info.backend_pid]).fetchone()[0]
        finally:
            interrupted.close()
        assert state() == before
        result['checks']['terminated_writer_transaction_rollback'] = 'PASS'
        for kind in ('payment', 'fulfillment'):
            record = max((r for r in records if r['event']['payload']['resourceType'] == kind), key=lambda r: r['event']['aggregateVersion'])
            tombstone = revision(record, record['event']['aggregateVersion'] + 1, deleted=True)
            assert projection.apply(tombstone) == 'applied'
            assert projection.apply(tombstone) == 'duplicate'
        deleted = revision(updated, 3, deleted=True)
        assert projection.apply(deleted) == 'applied'
        assert projection.apply(deleted) == 'duplicate'
        assert reader.orders(grant)['data'] == []
        result['checks']['child_then_order_tombstones_and_replay'] = 'PASS'
    finally:
        if started:
            command('pg_ctl', '-D', str(root / 'data'), '-m', 'fast', '-w', 'stop')
            result['cleanup'] = 'STOPPED'
        (root / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('new_scratch_root')
    parser.add_argument('completed_dbt_evidence')
    parser.add_argument('--pg-bin', required=True)
    args = parser.parse_args()
    run(args.new_scratch_root, args.completed_dbt_evidence, args.pg_bin)
