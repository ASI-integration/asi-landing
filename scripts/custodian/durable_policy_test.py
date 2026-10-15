"""Synthetic keys only. Tests never grant owner authority or execute actions."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parent))
import durable_policy as d

class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.assertNotEqual(os.getuid(), 0)
        self.temp = tempfile.TemporaryDirectory(prefix='policy-test-')
        self.base = Path(self.temp.name)
        self.root = self.base/'state'; self.root.mkdir(mode=0o700)
        self.key = self.base/'synthetic-key'
        self.pub = self.base/'synthetic-public'
        subprocess.run(['openssl','genpkey','-algorithm','ED25519','-out',str(self.key)],check=True,capture_output=True)
        subprocess.run(['openssl','pkey','-in',str(self.key),'-pubout','-out',str(self.pub)],check=True,capture_output=True)
        self.args = dict(issuer='synthetic-ci',key_id='test-key',key_sha256=d.digest(self.pub.read_bytes()),host='ephemeral-ci-only',archive_sha256='a'*64,enabled=True)
        self.boundary = self.open()
        self.boundary.initialize()
        self.left,self.right = socket.socketpair()
        self.policy = self.make_policy()
        self.publish(self.policy)
    def tearDown(self):
        self.left.close();self.right.close();self.temp.cleanup()
    def open(self, **extra):
        return d.Boundary(self.root,self.pub.read_bytes(),**(self.args|extra))
    def signed(self,value):
        raw=d.canonical(value)
        # Unique files make signer calls safe in concurrency tests.
        with tempfile.TemporaryDirectory(dir=self.base) as tmp:
            p=Path(tmp);(p/'data').write_bytes(raw)
            subprocess.run(['openssl','pkeyutl','-sign','-inkey',str(self.key),'-rawin','-in',str(p/'data'),'-out',str(p/'sig')],check=True,capture_output=True)
            return raw,(p/'sig').read_bytes()
    def make_policy(self, **extra):
        now=int(time.time())
        return self.boundary.pins|dict(epoch=1,issuedAt=now,expires=now+600,clientUid=os.getuid(),clientGid=os.getgid(),revoked=[],action='observe_synthetic')|extra
    def publish(self,p,**kw):return self.boundary.publish(*self.signed(p),**kw)
    def receipt(self, **extra):
        now=int(time.time())
        return self.boundary.pins|dict(epoch=self.policy['epoch'],policyDigest=d.digest(d.canonical(self.policy)),issuedAt=now,expires=now+50,clientUid=self.policy['clientUid'],clientGid=self.policy['clientGid'],action='observe_synthetic',nonce='b'*64,seq=1)|extra
    def consume(self,r=None,boundary=None,**kw):
        return (boundary or self.boundary).consume(self.left,*self.signed(r or self.receipt()),**kw)
    def flags(self,result):
        for key in ('authorized','canInstall','canApprove','canSend','canIssueReceipt'):self.assertIs(result[key],False)
        self.assertEqual(result['phase2'],'BLOCK')
    def test_synthetic_signature_and_readonly_attestation(self):
        before=(self.root/'state').read_bytes()
        self.flags(self.boundary.attest());self.assertEqual(before,(self.root/'state').read_bytes())
        self.flags(self.consume())
    def test_default_off(self):
        with self.assertRaisesRegex(d.Hold,'DEFAULT_OFF'):self.open(enabled=False).attest()
    def test_missing_state_does_not_reinitialize(self):
        (self.root/'state').unlink()
        with self.assertRaises(d.Hold):self.boundary.attest()
        self.assertFalse((self.root/'state').exists())
    def test_reinitialize_denied(self):
        with self.assertRaises(d.Hold):self.boundary.initialize()
    def test_altered_signature(self):
        raw,sig=self.signed(self.receipt())
        with self.assertRaises(d.Hold):self.boundary.consume(self.left,raw,bytes([sig[0]^1])+sig[1:])
    def test_wrong_host_issuer_keyid_archive_and_action(self):
        for key,value in [('host','other'),('issuer','other'),('keyId','other'),('archiveSha256','f'*64),('action','send_guest')]:
            with self.subTest(key=key),self.assertRaises(d.Hold):self.consume(self.receipt(**{key:value}))
    def test_unknown_key_rotation_denied(self):
        with self.assertRaises(d.Hold):self.publish(self.make_policy(epoch=2,keyId='new-issuer-key'))
    def test_changed_trust_pins_on_restart(self):
        with self.assertRaises(d.Hold):self.open(host='different').attest()
        with self.assertRaises(d.Hold):self.open(key_sha256='f'*64)
    def test_policy_expiry_future_and_receipt_expiry(self):
        now=int(time.time())
        for p in [self.make_policy(epoch=2,expires=now),self.make_policy(epoch=2,issuedAt=now+10)]:
            with self.assertRaises(d.Hold):self.publish(p)
        with self.assertRaises(d.Hold):self.consume(self.receipt(expires=now))
    def test_old_epoch_and_equivocation(self):
        self.publish(self.make_policy(epoch=2))
        with self.assertRaisesRegex(d.Hold,'OLD_EPOCH'):self.publish(self.policy)
        with self.assertRaisesRegex(d.Hold,'EQUIVOCATION'):self.publish(self.make_policy(epoch=2,revoked=['b'*64]))
    def test_exact_publish_retry(self):self.assertEqual(self.publish(self.policy)['status'],'SYNTHETIC_POLICY_UNCHANGED')
    def test_replay_restart_and_sequence(self):
        self.consume()
        with self.assertRaises(d.Hold):self.consume(boundary=self.open())
        with self.assertRaisesRegex(d.Hold,'REPLAY'):self.consume(self.receipt(seq=2),boundary=self.open())
        self.flags(self.consume(self.receipt(seq=2,nonce='c'*64),boundary=self.open()))
    def test_revocation_survives_rotation_and_restart(self):
        self.policy=self.make_policy(epoch=2,revoked=['b'*64]);self.publish(self.policy)
        self.policy=self.make_policy(epoch=3,revoked=[]);self.publish(self.policy)
        with self.assertRaisesRegex(d.Hold,'REVOKED'):self.consume(boundary=self.open())
    def test_consumed_nonce_survives_rotation(self):
        self.consume();self.policy=self.make_policy(epoch=2);self.publish(self.policy)
        with self.assertRaisesRegex(d.Hold,'REPLAY'):self.consume(self.receipt(seq=2))
    def test_corrupt_ledger_and_selective_rollback(self):
        old=(self.root/'state').read_bytes();self.consume();(self.root/'state').write_bytes(old)
        with self.assertRaisesRegex(d.Hold,'CHECKPOINT'):self.open().attest()
    def test_hash_consistent_but_malformed_ledger(self):
        state=json.loads((self.root/'state').read_bytes());state['events']=[{'seq':1}]
        raw=d.canonical(state);(self.root/'state').write_bytes(raw);(self.root/'checkpoint').write_text(d.digest(raw))
        with self.assertRaisesRegex(d.Hold,'LEDGER'):self.open().attest()
    def test_permission_symlink_and_hardlink_denied(self):
        state=self.root/'state';state.chmod(0o644)
        with self.assertRaises(d.Hold):self.boundary.attest()
        state.chmod(0o600);os.link(state,self.base/'linked')
        with self.assertRaises(d.Hold):self.boundary.attest()
        (self.base/'linked').unlink();state.rename(self.base/'original');state.symlink_to(self.base/'original')
        with self.assertRaises(d.Hold):self.boundary.attest()
    def test_read_failure_and_noncanonical_input(self):
        with patch.object(d,'read',side_effect=OSError('synthetic read fault')):
            with self.assertRaises(d.Hold):self.boundary.attest()
        raw,sig=self.signed(self.receipt())
        with self.assertRaises(d.Hold):self.boundary.consume(self.left,raw+b' ',sig)
        with self.assertRaises(d.Hold):self.boundary.consume(self.left,b'x'*4097,sig)
    def test_policy_signature_host_and_schema(self):
        raw,sig=self.signed(self.make_policy(epoch=2))
        with self.assertRaises(d.Hold):self.boundary.publish(raw,bytes([sig[0]^1])+sig[1:])
        with self.assertRaises(d.Hold):self.publish(self.make_policy(epoch=2,host='other-host'))
        with self.assertRaises(d.Hold):self.publish(self.make_policy(epoch=True))
        with self.assertRaises(d.Hold):self.publish(self.make_policy(epoch=2,unexpected='field'))
    def test_stale_policy_and_missing_checkpoint(self):
        with patch.object(d.time,'time',return_value=self.policy['expires']):
            with self.assertRaisesRegex(d.Hold,'EXPIRED'):self.open().attest()
        (self.root/'checkpoint').unlink()
        with self.assertRaises(d.Hold):self.open().attest()
    def test_lock_replaced_during_operation(self):
        original=self.boundary.verify
        def swapped(*args):
            original(*args)
            (self.root/'lock').unlink();d.new_file(self.root/'lock',b'')
        with patch.object(self.boundary,'verify',side_effect=swapped):
            with self.assertRaisesRegex(d.Hold,'REPLACED'):self.consume()
    def test_corrupt_stored_policy_cannot_be_healed_by_publish(self):
        state=json.loads((self.root/'state').read_bytes());state['policy']['raw']='{}'
        raw=d.canonical(state);(self.root/'state').write_bytes(raw);(self.root/'checkpoint').write_text(d.digest(raw))
        with self.assertRaises(d.Hold):self.publish(self.make_policy(epoch=2))
    def test_expired_intact_policy_can_rotate(self):
        later=self.policy['expires']+1
        with patch.object(d.time,'time',return_value=later):
            self.flags(self.publish(self.make_policy(epoch=2)))
    def test_actual_kernel_uid_and_gid_mismatch(self):
        for field in ('clientUid','clientGid'):
            self.policy=self.make_policy(epoch=self.policy['epoch']+1,**{field:os.getuid()+1000 if field=='clientUid' else os.getgid()+1000})
            self.publish(self.policy)
            with self.assertRaisesRegex(d.Hold,'KERNEL_PEER'):self.consume()
    def test_concurrent_double_consume(self):
        raw,sig=self.signed(self.receipt());barrier=threading.Barrier(2)
        def run():
            barrier.wait()
            try:return self.open().consume(self.left,raw,sig)['status']
            except d.Hold:return 'HOLD'
        with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:run(),range(2)))
        self.assertEqual(results.count('SYNTHETIC_OBSERVED'),1)
        self.assertEqual(self.open().attest()['consumed'],1)
    def test_revocation_rotation_serializes_with_consume(self):
        raw,sig=self.signed(self.receipt());reached=threading.Event();release=threading.Event()
        def fault(stage):
            if stage=='after_intent':reached.set();self.assertTrue(release.wait(5))
        def consume():return self.boundary.consume(self.left,raw,sig,fault=fault)
        with concurrent.futures.ThreadPoolExecutor(1) as pool:
            future=pool.submit(consume);self.assertTrue(reached.wait(5))
            try:
                with self.assertRaisesRegex(d.Hold,'BUSY'):self.publish(self.make_policy(epoch=2,revoked=['b'*64]))
            finally:release.set()
            self.flags(future.result())
        self.policy=self.make_policy(epoch=2,revoked=['b'*64]);self.publish(self.policy)
        with self.assertRaises(d.Hold):self.consume(self.receipt(seq=2))
    def test_clock_rollback(self):
        with patch.object(d.time,'time',return_value=int(time.time())-10):
            with self.assertRaisesRegex(d.Hold,'CLOCK'):self.open().attest()
    def test_sigkill_at_durable_boundaries(self):
        # Independent store for each crash point; real child SIGKILL, no fake success.
        for stage in ('after_intent','after_state','after_checkpoint','after_clear'):
            with self.subTest(stage=stage):
                sub=self.base/stage;sub.mkdir(mode=0o700)
                b=d.Boundary(sub,self.pub.read_bytes(),**self.args);b.initialize();b.publish(*self.signed(self.policy))
                raw,sig=self.signed(self.receipt());pid=os.fork()
                if pid==0:
                    try:
                        b.consume(self.left,raw,sig,fault=lambda point:os.kill(os.getpid(),signal.SIGKILL) if point==stage else None)
                    finally:os._exit(4)
                deadline=time.monotonic()+8
                while True:
                    done,status=os.waitpid(pid,os.WNOHANG)
                    if done:break
                    if time.monotonic()>=deadline:
                        os.kill(pid,signal.SIGKILL);os.waitpid(pid,0);self.fail('CHILD_TIMEOUT')
                    time.sleep(.02)
                self.assertTrue(os.WIFSIGNALED(status));self.assertEqual(os.WTERMSIG(status),signal.SIGKILL)
                if stage=='after_clear':
                    self.assertEqual(b.attest()['consumed'],1)
                    with self.assertRaises(d.Hold):b.consume(self.left,raw,sig)
                else:
                    with self.assertRaisesRegex(d.Hold,'UNRESOLVED'):b.attest()
    def test_uninitialized_missing_policy_and_wrong_root_permissions(self):
        other=self.base/'empty';other.mkdir(mode=0o700)
        b=d.Boundary(other,self.pub.read_bytes(),**self.args)
        with self.assertRaises(d.Hold):b.attest()
        b.initialize()
        with self.assertRaisesRegex(d.Hold,'POLICY_MISSING'):b.attest()
        other.chmod(0o750)
        with self.assertRaises(d.Hold):b.attest()

if __name__=='__main__':unittest.main(verbosity=2)
