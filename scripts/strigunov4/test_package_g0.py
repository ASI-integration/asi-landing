import json,tarfile,tempfile,unittest,hashlib
from pathlib import Path
from package_g0 import package
class PackTests(unittest.TestCase):
 def fixture(self,root):
  for d in ['.next','node_modules']: (root/d).mkdir()
  (root/'.next/BUILD_ID').write_text('test');(root/'package.json').write_text('{"version":"test"}')
  (root/'package-lock.json').write_text('{}');(root/'next.config.js').write_text('module.exports={};')
 def test_metadata_hash_and_no_activation(self):
  with tempfile.TemporaryDirectory() as d:
   r=Path(d);self.fixture(r);m=package(r,r/'out','a'*40,'b'*40)
   self.assertEqual(m['sha256'],hashlib.sha256((r/'out'/m['archive']).read_bytes()).hexdigest())
   with tarfile.open(r/'out'/m['archive']) as t:self.assertEqual(json.load(t.extractfile('release-meta.json'))['gitSha'],'a'*40)
   self.assertFalse(m['activationPerformed'])
 def test_unreviewed_example_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   r=Path(d);self.fixture(r);(r/'.env.example').write_text('unreviewed')
   with self.assertRaisesRegex(ValueError,'unreviewed_environment_template'):package(r,r/'out','a'*40,'b'*40)
 def test_env_rejected_before_archive(self):
  with tempfile.TemporaryDirectory() as d:
   r=Path(d);self.fixture(r);(r/'.env.local').write_text('fake')
   with self.assertRaisesRegex(ValueError,'credential'):package(r,r/'out','a'*40,'b'*40)
   self.assertFalse((r/'out').exists())
 def test_escaping_link_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   r=Path(d);self.fixture(r);(r/'node_modules/escape').symlink_to('/tmp')
   with self.assertRaisesRegex(ValueError,'escaping_symlink'):package(r,r/'out','a'*40,'b'*40)
if __name__=='__main__':unittest.main()
