"""Real nonroot subprocess/IPC checks, no independent owner authority claim."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'custodian' / 'asi_custodian.py'
spec = importlib.util.spec_from_file_location('custodian', SOURCE)
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class ProcessAcceptance(unittest.TestCase):
    def setUp(self):
        self.assertNotEqual(os.getuid(), 0)
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'state'
        self.children = []
        c.initialize(str(self.root), 'strig-cust-123456789abc', os.getuid(), os.getgid())

    def tearDown(self):
        for p in self.children:
            if p.poll() is None: p.kill()
            p.wait(timeout=5)
        self.temp.cleanup()

    def start(self, enabled=False):
        p = subprocess.Popen([sys.executable, str(SOURCE), 'serve', '--state-dir', str(self.root)] + (['--enable-technical-append'] if enabled else []), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.children.append(p)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if p.poll() is not None: return p
            try:
                if (self.root / 'custodian.sock').exists():
                    c.request_client(str(self.root), 'status', 0, '0' * 32, 'NONE')
                    return p
            except (OSError, ValueError): pass
            time.sleep(.02)
        self.fail('daemon start timeout')

    def call(self, op='status', seq=0, result='NONE'):
        return c.request_client(str(self.root), op, seq, 'a' * 32, result)

    def test_default_off(self):
        self.start()
        self.assertEqual(self.call('append', 1, 'OBSERVED')['reason'], 'APPEND_DISABLED')
        self.assertEqual((self.root / 'events.ndjson').read_bytes(), b'')

    def test_second_process_cannot_remove_active_socket(self):
        first = self.start(True)
        second = self.start(True)
        self.assertNotEqual(second.wait(timeout=5), 0)
        self.assertIsNone(first.poll())
        self.assertEqual(self.call()['status'], 'TECHNICAL_READBACK')

    def test_real_append_restart_and_replay(self):
        p = self.start(True)
        self.assertEqual(self.call('append', 1, 'OBSERVED')['status'], 'TECHNICAL_RECORDED')
        p.terminate(); self.assertEqual(p.wait(timeout=5), 0)
        self.start(True)
        self.assertEqual(self.call()['seq'], 1)
        self.assertEqual(self.call('append', 1, 'OBSERVED')['reason'], 'REPLAY_OR_GAP')

    def test_kernel_peer_denial(self):
        conf = self.root / 'config.json'
        value = json.loads(conf.read_text()); value['peerUid'] = os.getuid() + 1
        conf.write_text(json.dumps(value))
        self.start(True)
        self.assertEqual(self.call('append', 1, 'OBSERVED')['reason'], 'KERNEL_PEER_DENIED')
        self.assertEqual((self.root / 'events.ndjson').read_bytes(), b'')

    def test_sigkill_retains_state_and_refuses_stale_socket(self):
        p = self.start(True)
        self.assertEqual(self.call('append', 1, 'OBSERVED')['status'], 'TECHNICAL_RECORDED')
        before = (self.root / 'events.ndjson').read_bytes()
        p.send_signal(signal.SIGKILL); p.wait(timeout=5)
        restarted = self.start(True)
        self.assertNotEqual(restarted.wait(timeout=5), 0)
        self.assertTrue((self.root / 'custodian.sock').exists())
        self.assertEqual((self.root / 'events.ndjson').read_bytes(), before)

    def test_corrupt_ledger_refuses_start(self):
        (self.root / 'events.ndjson').write_bytes(b'{torn')
        self.assertNotEqual(self.start(True).wait(timeout=5), 0)

    def test_broad_journal_permissions_fail_closed(self):
        self.start(True)
        (self.root / 'events.ndjson').chmod(0o644)
        self.assertEqual(self.call('append', 1, 'OBSERVED')['status'], 'HOLD')

    def test_oversized_ipc_frame(self):
        self.start(True)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(4); s.connect(str(self.root / 'custodian.sock'))
            s.sendall(b'x' * 2050); s.shutdown(socket.SHUT_WR)
            self.assertEqual(json.loads(s.recv(4096))['status'], 'HOLD')
        self.assertEqual((self.root / 'events.ndjson').read_bytes(), b'')

class ReceiptProcessAcceptance(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('receipt_tests', SOURCE.parents[1] / '__tests__' / 'asi_task32.test.py')
        self.module = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.module)
        self.fixture = self.module.Acceptance(); self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)

    def killed_receipt(self, boundary):
        f = self.fixture; p = self.module.p
        data, signature = f.sign(f.receipt)
        pid = os.fork()
        if pid == 0:
            original_sync = p.sync_dir; original_fsync = os.fsync
            def sync(directory):
                original_sync(directory)
                if boundary == 'intent' and directory == f.state: os.kill(os.getpid(), signal.SIGKILL)
            def fsync(fd):
                original_fsync(fd)
                if boundary == 'journal' and os.readlink('/proc/self/fd/' + str(fd)).endswith('/journal'): os.kill(os.getpid(), signal.SIGKILL)
            p.sync_dir = sync; os.fsync = fsync
            try: f.gate().consume(data, signature, f.client, 1)
            finally: os._exit(91)
        deadline = time.monotonic() + 15; status = None
        try:
            while time.monotonic() < deadline:
                done, value = os.waitpid(pid, os.WNOHANG)
                if done: status = value; break
                time.sleep(.02)
            self.assertIsNotNone(status)
            self.assertTrue(os.WIFSIGNALED(status)); self.assertEqual(os.WTERMSIG(status), signal.SIGKILL)
        finally:
            if status is None: os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0)
        self.assertTrue((f.state / 'pending').exists())
        f.receipt['nonce'] = 'b' * 64
        with self.assertRaises(p.Denied): f.consume()

    def test_actual_sigkill_after_durable_intent(self): self.killed_receipt('intent')
    def test_actual_sigkill_after_journal_fsync(self): self.killed_receipt('journal')
    def test_fifo_and_oversized_input_refused(self):
        p = self.module.p; root = self.fixture.root
        fifo = root / 'fifo'; os.mkfifo(fifo)
        with self.assertRaises(p.Denied): p.bounded_bytes(fifo, 64)
        large = root / 'large'; large.write_bytes(b'x' * 65)
        with self.assertRaises(p.Denied): p.bounded_bytes(large, 64)

if __name__ == '__main__': unittest.main(verbosity=2)
