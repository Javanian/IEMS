"""Airflow 3.1 DAG. Mount jobs/analytics on PYTHONPATH in the worker image."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from airflow.sdk import dag, task, get_current_context


@dag(dag_id='iems_reporting_v1', schedule='@daily', start_date=datetime(2026,1,1,tzinfo=timezone.utc), catchup=False, max_active_runs=1, default_args={'retries':2,'retry_delay':timedelta(minutes=2),'execution_timeout':timedelta(minutes=15)}, tags=['iems','projection'])
def reporting():
    @task
    def publish():
        from publish import build
        ctx = get_current_context()
        # Selection is an operator-owned immutable input list, never an arbitrary DAG-conf path.
        root = Path(os.environ['IEMS_ANALYTICS_INPUT_ROOT']).resolve()
        interval = {'start':ctx['data_interval_start'].isoformat(),'end':ctx['data_interval_end'].isoformat()}
        selection = root / (ctx['data_interval_end'].strftime('%Y%m%dT%H%M%SZ')+'.json')
        relative = json.loads(selection.read_text())
        if isinstance(relative,list):
            relative={'manifests':relative,'coverage':[]}
        manifests = [(root/p).resolve() for p in relative['manifests']]
        coverage = [(root/p).resolve() for p in relative.get('coverage',[])]
        if not manifests or any(root not in p.parents for p in [*manifests,*coverage]):
            raise ValueError('Input manifest outside owned root')
        run_id = 'interval-'+ctx['data_interval_end'].strftime('%Y%m%dT%H%M%SZ')
        return build(os.environ['IEMS_ANALYTICS_PUBLISH_ROOT'],manifests,run_id,interval,os.environ['IEMS_DBT_PROJECT'],os.environ['IEMS_DBT_PROFILES'],coverage_manifests=coverage)['hash']
    publish()


reporting()
