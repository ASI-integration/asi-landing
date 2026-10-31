import importlib.util
import hashlib
import json
from pathlib import Path
import stat
import tempfile
import unittest

P=Path(__file__).with_name('beget-active-exchange-rehearsal.py')
spec=importlib.util.spec_from_file_location('asi_active_exchange',P)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def sha(x):return hashlib.sha256(x).hexdigest()
def fixture(root):
    for name,data in [('generation-active',b'old engine generation\n'),
                      ('generation-next',b'new engine generation\n')]:
        folder=root/name
        folder.mkdir(mode=0o700)
        (folder/'module.mjs').write_bytes(data)
        (folder/'manifest.json').write_text(json.dumps({
            'generation':name,'sha256':sha(data)})+'\n')
    state=root/'private-state'
    state.mkdir(mode=0o700)
    (state/'ledger.json').write_text('{"claims":["durable-no-replay"]}\n')
class UpgradeRehearsal(unittest.TestCase):
    def with_root(self,callback):
        with tempfile.TemporaryDirectory(prefix='asi-upgrade-rehearsal-',dir='/tmp') as p:
            root=Path(p);root.chmod(0o700);fixture(root)
            return callback(root)
    def test_preserves_original_and_state_during_real_atomic_exchange(self):
        def run(root):
            old=(root/'generation-active'/'module.mjs').read_bytes()
            state=(root/'private-state'/'ledger.json').read_bytes()
            result=m.rehearse(root)
            self.assertTrue(result['atomicExchangeDemonstrated'])
            self.assertFalse(result['authorized'])
            self.assertFalse(result['installable'])
            self.assertEqual((root/'generation-active'/'module.mjs').read_bytes(),
                             b'new engine generation\n')
            self.assertEqual((root/'generation-next'/'module.mjs').read_bytes(),old)
            self.assertEqual((root/'private-state'/'ledger.json').read_bytes(),state)
        self.with_root(run)
    def test_dry_run_does_not_exchange(self):
        def run(root):
            old=(root/'generation-active'/'module.mjs').read_bytes()
            r=m.rehearse(root,dry_run=True)
            self.assertFalse(r['atomicExchangeDemonstrated'])
            self.assertEqual((root/'generation-active'/'module.mjs').read_bytes(),old)
        self.with_root(run)
    def test_mismatched_payload_never_switches(self):
        def run(root):
            (root/'generation-next'/'module.mjs').write_text('unverified change')
            with self.assertRaises(m.Block): m.rehearse(root)
            self.assertEqual((root/'generation-active'/'module.mjs').read_bytes(),
                             b'old engine generation\n')
        self.with_root(run)
    def test_extra_file_or_symlink_blocks(self):
        def run(root):
            (root/'generation-next'/'outside.txt').write_text('no')
            with self.assertRaises(m.Block):m.rehearse(root)
        self.with_root(run)
    def test_root_is_never_allowed_as_live_path(self):
        with self.assertRaises(m.Block):m.rehearse(Path('/opt/asi-engine'))
        with self.assertRaises(m.Block):m.rehearse(Path('/var/lib/asi-engine'))
    def test_untrusted_state_symlink_blocks(self):
        def run(root):
            (root/'private-state'/'ledger.json').unlink()
            (root/'private-state'/'ledger.json').symlink_to('/etc/passwd')
            with self.assertRaises(m.Block):m.rehearse(root)
        self.with_root(run)
if __name__=='__main__':
    unittest.main()
