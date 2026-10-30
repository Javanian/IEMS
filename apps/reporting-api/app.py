from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import Response


def create_app(catalog, authenticate, reporting=None):
    """authenticate is a mandatory fresh server-side authority dependency, never header claims."""
    if not callable(authenticate):
        raise ValueError('Authority adapter required')
    app=FastAPI(title='IEMS reporting projection',version='1')

    def call(effect):
        try:
            return effect()
        except PermissionError:
            raise HTTPException(403, detail={'code':'SCOPE_DENIED','nextState':'Request dataset access.'})
        except FileNotFoundError:
            raise HTTPException(404, detail={'code':'DATASET_UNAVAILABLE','nextState':'Wait for a trusted publication.'})
        except ValueError:
            raise HTTPException(409, detail={'code':'DATASET_NOT_TRUSTED','nextState':'Ask the data operator to reconcile or refresh the dataset.'})

    @app.get('/v1/catalog')
    def listing(grant=Depends(authenticate)):
        return call(lambda:{'data':catalog.listing(grant)})

    @app.get('/v1/datasets/{dataset}')
    def dataset(dataset:str,runId:str|None=None,after:str|None=None,limit:int=Query(100,ge=1,le=1000),grant=Depends(authenticate)):
        return call(lambda:catalog.read(grant,dataset,runId,after,limit))

    @app.get('/v1/datasets/{dataset}/export')
    def export(dataset:str,runId:str,grant=Depends(authenticate)):
        body,result=call(lambda:catalog.export(grant,dataset,runId))
        return Response(body,media_type='text/csv',headers={'Cache-Control':'no-store','Content-Disposition':'attachment; filename="iems-report.csv"','X-Lineage-Hash':result['lineageHash']})

    if reporting:
        @app.get('/v1/orders')
        def orders(after:str|None=None,limit:int=Query(100,ge=1,le=1000),grant=Depends(authenticate)):
            return call(lambda:reporting.orders(grant,after,limit))
    return app
