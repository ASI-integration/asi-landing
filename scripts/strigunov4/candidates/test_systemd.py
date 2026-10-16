import sys,unittest
from unittest.mock import patch
import systemd_candidate as s
class CandidateTests(unittest.TestCase):
 def test_execute_always_blocked_before_preflight(self):
  with patch.object(sys,'argv',['x','--execute']),patch.object(s,'preflight') as p:
   with self.assertRaisesRegex(RuntimeError,'PROTECTED_APPLY_BACKEND_NOT_INTEGRATED'):s.main()
   p.assert_not_called()
 def test_effective_no_send_required(self):
  raw=b'\0'.join((k+'='+v).encode() for k,v in s.FLAGS.items() if k!='ASI_SYNTHETIC_NO_SEND')
  with patch.object(s.Path,'read_bytes',return_value=raw):
   with self.assertRaisesRegex(RuntimeError,'unsafe_effective_flags'):s.effective_flags('123')
 def test_production_default_root_rejected(self):
  raw=b'\0'.join((k+'='+v).encode() for k,v in s.FLAGS.items() if k!='ASI_APP_ROOT')
  with patch.object(s.Path,'read_bytes',return_value=raw):
   with self.assertRaisesRegex(RuntimeError,'unsafe_effective_flags'):s.effective_flags('123')
 def test_effective_no_send_pass(self):
  raw=b'\0'.join((k+'='+v).encode() for k,v in s.FLAGS.items())
  with patch.object(s.Path,'read_bytes',return_value=raw):s.effective_flags('123')
 def test_metadata_contract(self):
  s.validate_release_metadata({'gitSha':s.NEW})
  with self.assertRaisesRegex(RuntimeError,'artifact_sha_mismatch'):s.validate_release_metadata({'sha':s.NEW})
if __name__=='__main__':unittest.main()
