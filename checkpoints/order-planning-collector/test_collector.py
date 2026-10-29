import json
from pathlib import Path
import tempfile
import unittest
from collector import stop, write_json
from parser import parse


class ArtifactTests(unittest.TestCase):
    def fixture(self, root):
        row={'schema':'IEMS_LOOPBACK_V1','seq':0,'monotonicNs':1,'tcp':{'rows':[]},'sampleCostMs':1}
        raw=json.dumps(row)+'\n'
        (root/'samples.ndjson').write_bytes(raw.encode())
        write_json(root/'owner.json',{'schema':'IEMS_LOOPBACK_V1','sessionToken':'owned'},True)
        write_json(root/'summary.json',{'schema':'IEMS_LOOPBACK_V1','reason':'STOP_REQUEST','durationMs':100,'errors':0,'sessionToken':'owned','samples':1,'bytes':len(raw.encode())},True)
        return row

    def test_parse_and_stop_idempotence_and_wrong_owner(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);self.fixture(root)
            self.assertEqual(parse(root)['summary']['samples'],1)
            stop(root,'owned');stop(root,'owned')
            with self.assertRaisesRegex(ValueError,'OWNER_TOKEN'):
                stop(root,'foreign')

    def test_truncation_and_summary_tampering_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);self.fixture(root)
            path=root/'samples.ndjson';original=path.read_bytes()
            path.write_bytes(original[:-1])
            with self.assertRaisesRegex(ValueError,'TRUNCATION'):parse(root)
            path.write_bytes(original+b'\n')
            with self.assertRaises((ValueError,json.JSONDecodeError)):parse(root)

    def test_external_endpoint_and_out_of_order_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);row=self.fixture(root)
            row['tcp']['rows']=[{'local':['10.0.0.1',123],'remote':['127.0.0.1',1]}]
            (root/'samples.ndjson').write_text(json.dumps(row)+'\n')
            with self.assertRaisesRegex(ValueError,'REDACTION'):parse(root)
            row['tcp']['rows']=[];row['seq']=2
            (root/'samples.ndjson').write_text(json.dumps(row)+'\n')
            with self.assertRaisesRegex(ValueError,'SEQUENCE'):parse(root)


    def test_unknown_endstate_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);self.fixture(root)
            summary=json.loads((root/'summary.json').read_text());summary['reason']='UNKNOWN'
            (root/'summary.json').write_text(json.dumps(summary))
            with self.assertRaisesRegex(ValueError,'ENDSTATE'):parse(root)


if __name__=='__main__':unittest.main()
