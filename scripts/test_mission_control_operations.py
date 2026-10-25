"""Offline reporter regression: no network and no changes to monitored jobs."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('reporter', Path(__file__).with_name('mission-control-reporter.py'))
reporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reporter)

class OperationsReporterTest(unittest.TestCase):
    def test_backup_read_only_and_redacted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'jobs').mkdir()
            summary = root / 'summary.json'
            summary.write_text(json.dumps(dict(status='RUNNING', verified_files=3, planned_files=9, verified_gib=.5, errors=0, secret='DO_NOT_EXPORT')))
            (root / 'jobs/backup.json').write_text(json.dumps(dict(kind='backup_v1', summary_file=str(summary), gib_total=1, pid=123)))
            before = summary.read_bytes()
            with patch.object(reporter, 'operation_process', return_value='PRESENT'):
                payload = reporter.operations_snapshot(root)
            self.assertEqual(payload['records'][0]['completed'], 3)
            self.assertEqual(payload['records'][0]['task'], 'ACTIVE')
            self.assertNotIn(str(root), json.dumps(payload)); self.assertNotIn('DO_NOT_EXPORT', json.dumps(payload))
            self.assertEqual(summary.read_bytes(), before)
            summary.write_text('{partial')
            self.assertEqual(reporter.operations_snapshot(root)['records'][0]['status'], 'UNKNOWN')

    def test_worker_presence_is_not_task_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'jobs').mkdir()
            (root / 'jobs/worker.json').write_text(json.dumps(dict(kind='process', pid=456)))
            with patch.object(reporter, 'operation_process', return_value='PRESENT'):
                record = reporter.operations_snapshot(root)['records'][2]
            self.assertEqual(record['status'], 'RUNNING'); self.assertEqual(record['task'], 'UNKNOWN')
            self.assertIsNone(record['completed'])

    def test_inventory_excludes_key_names_and_source_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); inventory = root / 'inventory.json'
            inventory.write_text(json.dumps(dict(key='PRIVATE_KEY', note='/home/private', batches=[dict(batch=n, verification='PASS', sha256='a'*64, encrypted_bytes=123, encrypted_file='/private') for n in ['core','video','releases','supplemental']])))
            record = reporter.operations_snapshot(root, inventory)['records'][1]
            self.assertEqual(record['status'], 'DONE'); self.assertEqual(len(record['archives']), 4)
            self.assertNotIn('PRIVATE', json.dumps(record)); self.assertNotIn('/private', json.dumps(record))

    def test_cleartext_and_redirects_never_receive_credentials(self):
        with patch.object(reporter.urllib.request, 'build_opener') as opener:
            self.assertEqual(reporter.post_operations('http://example.invalid/api/internal/mission-control/status', {}, {}), (False, 'https_endpoint_required'))
            opener.assert_not_called()
        self.assertIsNone(reporter.OperationsNoRedirect().redirect_request(None,None,302,'',{},'https://other.invalid'))

if __name__ == '__main__':
    unittest.main()
