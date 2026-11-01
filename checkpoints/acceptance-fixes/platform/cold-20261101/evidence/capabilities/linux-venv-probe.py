import sys, importlib.util, json
print(json.dumps({'version':sys.version,'executable':sys.executable,'modules':{name:importlib.util.find_spec(name) is not None for name in ['airflow','pyspark','pyflink']}}))
