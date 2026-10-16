import json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import build_candidate as b
import systemd_candidate as s
class SafetyTests(unittest.TestCase):
 def test_execute_fails_before_host_or_network_access(self):
  with patch.object(sys,'argv',['candidate','--execute','--receipt','fake.json']),patch.object(s,'preflight') as pre,patch.object(s,'run') as run,patch.object(s,'swap') as swap:
   with self.assertRaisesRegex(RuntimeError,'PROTECTED_APPLY_BACKEND_NOT_INTEGRATED'):s.main()
   pre.assert_not_called();run.assert_not_called();swap.assert_not_called()
 def test_default_excludes_unknown_purpose_repair(self):
  plan=b.build()
  self.assertFalse(plan['purpose_repair_included'])
  self.assertFalse(any(x['file'].startswith('20260810280000') for x in plan['files']))
  self.assertNotIn('DROP CONSTRAINT IF EXISTS booking_ops_communication_purpose_check',(b.ROOT/'rehearse.sql').read_text())
 def test_opt_in_requires_rationale(self):
  with self.assertRaisesRegex(ValueError,'rationale'):b.build(True)
 def test_explicit_opt_in_is_rollback_only(self):
  # Render to an isolated temporary directory; never leave opt-in output as default.
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'sql').symlink_to(b.ROOT/'sql');(root/'catalog-baseline.json').symlink_to(b.ROOT/'catalog-baseline.json')
   with patch.object(b,'ROOT',root):
    p=b.build(True,'Example test rationale, not an approval')
    self.assertTrue(p['purpose_repair_included'])
    self.assertTrue((root/'rehearse.sql').read_text().rstrip().endswith('ROLLBACK;'))
    self.assertFalse(p['live_execution_allowed'])
if __name__=='__main__':unittest.main()
