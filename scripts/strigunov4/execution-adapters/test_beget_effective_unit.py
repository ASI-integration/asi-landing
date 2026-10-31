"""Fixture-only: effective loaded systemd identity must match the signed unit.

No service, root path, signature, or protected state access.
"""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

MODULE=Path(__file__).with_name("beget-install.py")
spec=importlib.util.spec_from_file_location("beget_exact_unit", MODULE)
installer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

ARGV=("/usr/bin/flock -n -E 73 --no-fork /run/asi-engine/worker.lock "
      "/opt/asi-engine/node "
      "/opt/asi-engine/scripts/strigunov4/ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.mjs --beget")
BASE={
 "LoadState":"loaded", "ActiveState":"inactive", "MainPID":"0",
 "UnitFileState":"disabled", "FragmentPath":"/etc/systemd/system/asi-strigunov-agent.service",
 "DropInPaths":"", "User":"asi-engine", "Group":"asi-engine",
 "NeedDaemonReload":"no",
 "ExecStart":f"{{ path=/usr/bin/flock ; argv[]={ARGV} ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }}",
 "NoNewPrivileges":"yes", "ProtectSystem":"strict", "ProtectHome":"yes", "PrivateTmp":"yes", "PrivateDevices":"yes",
 "CapabilityBoundingSet":"", "AmbientCapabilities":"",
 "RestrictAddressFamilies":"AF_INET AF_INET6 AF_NETLINK AF_UNIX",
 "ReadWritePaths":"/var/lib/asi-engine /run/asi-engine",
 "WorkingDirectory":"/var/lib/asi-engine",
}

class EffectiveUnitAdmission(unittest.TestCase):
 def call_case(self, changed=None, accepted=False):
  fields=dict(BASE)
  if changed: fields.update(changed)
  def fake_call(argv,**kwargs):
   self.assertEqual(argv[:3], ['/usr/bin/systemctl','show',installer.UNIT])
   args=[v[2:] for v in argv if v.startswith('-p') and v!='-p']
   self.assertGreater(len(args),0)
   return ''.join(f"{key}={fields[key]}\n" for key in args).encode()
  with patch.object(installer,'call',side_effect=fake_call):
   if accepted:
    installer.exact_disabled_unit_state()
   else:
    with self.assertRaisesRegex(installer.Block,'STAGED_UNIT_NOT_DISABLED'):
     installer.exact_disabled_unit_state()

 def test_expected_effective_unit_allowed(self):self.call_case(accepted=True)
 def test_reject_stale_loaded_unit(self):self.call_case({'NeedDaemonReload':'yes'})
 def test_reject_different_exec_start(self):self.call_case({'ExecStart':BASE['ExecStart'].replace('/opt/asi-engine/node','/bin/sh')})
 def test_reject_unsafe_capability(self):self.call_case({'CapabilityBoundingSet':'cap_sys_admin'})
 def test_reject_disabled_no_new_privileges(self):self.call_case({'NoNewPrivileges':'no'})
 def test_reject_protect_system_weakened(self):self.call_case({'ProtectSystem':'full'})
 def test_reject_additional_write_path(self):self.call_case({'ReadWritePaths':'/var/lib/asi-engine /run/asi-engine /etc'})
 def test_reject_unexpected_address_family(self):self.call_case({'RestrictAddressFamilies':'AF_INET AF_INET6 AF_NETLINK AF_UNIX AF_PACKET'})

if __name__=='__main__':unittest.main()
