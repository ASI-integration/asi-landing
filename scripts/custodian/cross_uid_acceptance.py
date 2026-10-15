"""Synthetic hosted Linux IPC acceptance; no account creation or installation.

Run only in an explicitly approved disposable GitHub runner. Root supervises
children with existing runner/nobody identities; the daemon itself is nonroot.
"""
import json
import os
from pathlib import Path
import pwd
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

PROBE = r'''
import json,socket,sys
msg={"kind":"ASI_CUSTODIAN_TECHNICAL_V0","op":sys.argv[2],"seq":int(sys.argv[3]),
"runId":"strig-cust-123456789abc","requestId":sys.argv[4],"result":sys.argv[5]}
with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
 s.settimeout(3);s.connect(sys.argv[1]);s.sendall(json.dumps(msg).encode()+b"\n");s.shutdown(socket.SHUT_WR)
 result=b""
 while len(result)<=2048:
  part=s.recv(1024)
  if not part:break
  result+=part
 if len(result)>2048:raise ValueError("response too large")
 print(result.decode())
'''


class CrossUidAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if (sys.platform != 'linux' or os.getuid() != 0
                or os.environ.get('CI') != 'true'
                or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted'
                or os.environ.get('STRIGUNOV_SYNTHETIC_ONLY') != 'YES'):
            raise RuntimeError('ISOLATED_HOSTED_SYNTHETIC_RUNNER_REQUIRED')
        cls.service_uid = int(os.environ['SUDO_UID'])
        cls.service_gid = int(os.environ['SUDO_GID'])
        cls.client_user = pwd.getpwnam('nobody')
        if cls.service_uid <= 0 or cls.service_uid == cls.client_user.pw_uid:
            raise RuntimeError('EXISTING_DISTINCT_NONROOT_IDENTITIES_REQUIRED')
        if cls.service_gid == cls.client_user.pw_gid:
            raise RuntimeError('DISTINCT_PRIMARY_GROUPS_REQUIRED')
        pwd.getpwuid(cls.service_uid)

    def identity(self, uid, gid, groups=()):
        def drop():
            os.setgroups(list(groups)); os.setgid(gid); os.setuid(uid)
        return drop

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cust-ipc-')
        self.base = Path(self.temp.name)
        self.base.chmod(0o755)  # root-owned harness parent, not the service vault
        self.script = self.base / 'asi_custodian.py'
        shutil.copyfile(Path(__file__).with_name('asi_custodian.py'), self.script)
        self.script.chmod(0o644)
        self.state_parent = self.base / 'service'
        self.state_parent.mkdir(mode=0o700)
        os.chown(self.state_parent, self.service_uid, self.service_gid)
        self.state = self.state_parent / 'state'
        self.ipc = self.base / 'ipc'
        self.ipc.mkdir()
        os.chown(self.ipc, self.service_uid, self.client_user.pw_gid)
        self.ipc.chmod(0o2710)
        self.children = []
        r = self.service('init', '--state-dir', str(self.state), '--run-id',
                         'strig-cust-123456789abc', '--peer-uid', str(self.client_user.pw_uid),
                         '--peer-gid', str(self.client_user.pw_gid))
        self.assertEqual(r.returncode, 0, r.stderr)

    def tearDown(self):
        for p in self.children:
            if p.poll() is None: p.kill()
            p.wait(timeout=5)
        self.temp.cleanup()

    def service(self, *args):
        return subprocess.run([sys.executable, str(self.script), *args],
            preexec_fn=self.identity(self.service_uid, self.service_gid),
            capture_output=True, text=True, timeout=8)

    def start(self, enabled=False):
        command = [sys.executable, str(self.script), 'serve', '--state-dir', str(self.state),
                   '--ipc-dir', str(self.ipc)]
        if enabled: command.append('--enable-technical-append')
        p = subprocess.Popen(command, preexec_fn=self.identity(self.service_uid, self.service_gid),
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.children.append(p)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if p.poll() is not None: return p
            try:
                if self.probe().returncode == 0: return p
            except (OSError, subprocess.TimeoutExpired): pass
            time.sleep(.03)
        self.fail('IPC_NOT_READY')

    def probe(self, op='status', seq=0, request_id='a'*32, result='NONE', uid=None, gid=None, groups=()):
        return subprocess.run([sys.executable, '-c', PROBE, str(self.ipc/'custodian.sock'),
                               op, str(seq), request_id, result],
            preexec_fn=self.identity(self.client_user.pw_uid if uid is None else uid,
                                    self.client_user.pw_gid if gid is None else gid, groups),
            capture_output=True, text=True, timeout=5)

    def answer(self, *args, **kwargs):
        r = self.probe(*args, **kwargs)
        self.assertEqual(r.returncode, 0, r.stderr)
        answer = json.loads(r.stdout)
        self.assertFalse(answer['authorized']); self.assertFalse(answer['canSend'])
        self.assertEqual(answer['phase2'], 'BLOCK')
        return answer

    def test_distinct_uid_real_ipc_default_off_and_private_vault(self):
        self.start()
        self.assertEqual(self.answer()['status'], 'TECHNICAL_READBACK')
        self.assertEqual(self.answer('append', 1, result='OBSERVED')['reason'], 'APPEND_DISABLED')
        for path in [self.state/'config.json', self.state/'events.ndjson']:
            r = subprocess.run([sys.executable, '-c', 'import pathlib,sys;pathlib.Path(sys.argv[1]).read_bytes()', str(path)],
                preexec_fn=self.identity(self.client_user.pw_uid, self.client_user.pw_gid),
                capture_output=True, timeout=5)
            self.assertNotEqual(r.returncode, 0)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)

    def test_primary_gid_checked_even_with_socket_supplementary_group(self):
        self.start(True)
        answer = self.answer('append', 1, result='OBSERVED', gid=self.service_gid,
                             groups=[self.client_user.pw_gid])
        self.assertEqual(answer['reason'], 'KERNEL_PEER_DENIED')
        self.assertEqual((self.state/'events.ndjson').read_bytes(), b'')

    def test_wrong_uid_same_socket_group_denied(self):
        self.start(True)
        self.assertEqual(self.answer(uid=self.service_uid, gid=self.client_user.pw_gid)['reason'], 'KERNEL_PEER_DENIED')

    def test_revocation_config_change_holds_live_instance_and_restart_denies_old_peer(self):
        p = self.start(True)
        conf = self.state/'config.json'
        value = json.loads(conf.read_text()); value['peerUid'] = self.service_uid
        conf.write_text(json.dumps(value))
        self.assertEqual(self.answer('append', 1, result='OBSERVED')['status'], 'HOLD')
        p.terminate(); self.assertEqual(p.wait(timeout=5), 0)
        self.start(True)
        self.assertEqual(self.answer()['reason'], 'KERNEL_PEER_DENIED')
        self.assertEqual((self.state/'events.ndjson').read_bytes(), b'')

    def test_append_replay_survives_graceful_restart(self):
        p = self.start(True)
        self.assertEqual(self.answer('append', 1, result='OBSERVED')['status'], 'TECHNICAL_RECORDED')
        p.terminate(); self.assertEqual(p.wait(timeout=5), 0)
        self.start(True)
        self.assertEqual(self.answer()['seq'], 1)
        self.assertEqual(self.answer('append', 1, result='OBSERVED')['reason'], 'REPLAY_OR_GAP')

    def test_sigkill_stale_endpoint_stays_hold(self):
        p = self.start(True)
        self.assertEqual(self.answer('append', 1, result='OBSERVED')['status'], 'TECHNICAL_RECORDED')
        p.send_signal(signal.SIGKILL); p.wait(timeout=5)
        restarted = self.start(True)
        self.assertNotEqual(restarted.wait(timeout=5), 0)
        self.assertTrue((self.ipc/'custodian.sock').exists())

    def test_group_writable_ipc_refused(self):
        self.ipc.chmod(0o2730)
        self.assertNotEqual(self.start(True).wait(timeout=5), 0)
        self.assertFalse((self.ipc/'custodian.sock').exists())


if __name__ == '__main__': unittest.main(verbosity=2)
