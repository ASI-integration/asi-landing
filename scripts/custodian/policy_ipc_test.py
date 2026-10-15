"""Real subprocess/AF_UNIX acceptance, disposable synthetic signer only."""
import concurrent.futures
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

import asi_custodian as c
import durable_policy as d
from policy_ipc import PROTOCOL

HERE = Path(__file__).resolve().parent
RUN = 'strig-cust-0123456789ab'

class IPC(unittest.TestCase):
    def setUp(self):
        self.assertNotEqual(os.getuid(), 0)
        self.tmp = tempfile.TemporaryDirectory(prefix='asi-ipc-')
        self.base = Path(self.tmp.name)
        self.state = self.base/'recorder'
        c.initialize(str(self.state), RUN, os.getuid(), os.getgid())
        self.root = self.base/'policy'; self.root.mkdir(mode=0o700)
        self.key = self.base/'synthetic-key'; self.pub = self.base/'public'
        subprocess.run(['openssl','genpkey','-algorithm','ED25519','-out',str(self.key)],check=True,capture_output=True)
        subprocess.run(['openssl','pkey','-in',str(self.key),'-pubout','-out',str(self.pub)],check=True,capture_output=True)
        self.args = dict(issuer='synthetic-ci',key_id='synthetic-key',key_sha256=d.digest(self.pub.read_bytes()),host='ephemeral-ci',archive_sha256='a'*64,enabled=True)
        self.boundary = d.Boundary(self.root,self.pub.read_bytes(),**self.args)
        self.boundary.initialize()
        now = int(time.time())
        self.policy = self.boundary.pins|dict(epoch=1,issuedAt=now,expires=now+600,clientUid=os.getuid(),clientGid=os.getgid(),revoked=[],action='observe_synthetic')
        self.publish()
        self.config = dict(schema=1,policyRoot=str(self.root),publicKey=self.pub.read_text(),issuer=self.args['issuer'],keyId=self.args['key_id'],keySha256=self.args['key_sha256'],host=self.args['host'],archiveSha256=self.args['archive_sha256'])
        d.new_file(self.state/'policy-consult.json',d.canonical(self.config))
        self.proc = None
        self.start()
    def tearDown(self):
        self.stop();self.tmp.cleanup()
    def sign(self,item):
        raw=d.canonical(item)
        with tempfile.TemporaryDirectory(dir=self.base) as tmp:
            p=Path(tmp);(p/'input').write_bytes(raw)
            subprocess.run(['openssl','pkeyutl','-sign','-inkey',str(self.key),'-rawin','-in',str(p/'input'),'-out',str(p/'sig')],check=True,capture_output=True)
            return raw,(p/'sig').read_bytes()
    def publish(self):
        return self.boundary.publish(*self.sign(self.policy))
    def receipt(self,**changes):
        now=int(time.time())
        return self.boundary.pins|dict(epoch=self.policy['epoch'],policyDigest=d.digest(d.canonical(self.policy)),issuedAt=now,expires=now+50,clientUid=self.policy['clientUid'],clientGid=self.policy['clientGid'],action='observe_synthetic',nonce='b'*64,seq=1)|changes
    def frame(self,receipt=None,**changes):
        raw,sig=self.sign(receipt or self.receipt())
        return d.canonical(dict(kind=PROTOCOL,op='consult',runId=RUN,receipt=raw.decode(),signature=sig.hex())|changes)+b'\n'
    def flags(self,result):
        for k in ('authorized','canSend','canApprove','canIssueReceipt','canInstall'):self.assertIs(result[k],False)
        self.assertEqual(result['phase2'],'BLOCK')
        self.assertEqual(result['rollbackProtection'],'NOT_ACCEPTED')
        self.assertEqual(result['trustedTime'],'NOT_ACCEPTED')
    def start(self,enabled=True,crash=False):
        self.log=open(self.base/'service.log','ab')
        args=[sys.executable,str(HERE/'asi_custodian.py'),'serve','--state-dir',str(self.state)]
        if enabled:args+=['--enable-synthetic-policy-consult']
        if crash:
            # Test-only process wrapper; no production fault flag or endpoint.
            script = "import os,signal,sys;sys.path.insert(0,sys.argv.pop(1));import durable_policy as d;import asi_custodian as c;original=d.Boundary.commit;d.Boundary.commit=lambda self,state,fd,fault=None:original(self,state,fd,lambda stage:os.kill(os.getpid(),signal.SIGKILL) if stage=='after_clear' else None);raise SystemExit(c.main())"
            args=[sys.executable,'-c',script,str(HERE)]+args[2:]
        self.proc=subprocess.Popen(args,stdout=self.log,stderr=self.log)
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            if self.proc.poll() is not None:self.fail('SERVICE_EXIT: '+(self.base/'service.log').read_text())
            if (self.state/'custodian.sock').exists():return
            time.sleep(.02)
        self.fail('SERVICE_START_TIMEOUT')
    def stop(self):
        if self.proc is not None:
            if self.proc.poll() is None:
                self.proc.terminate()
                try:self.proc.wait(4)
                except subprocess.TimeoutExpired:self.proc.kill();self.proc.wait(2)
            self.log.close();self.proc=None
    def call(self,raw):
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as conn:
            conn.settimeout(5);conn.connect(str(self.state/'custodian.sock'))
            try:conn.sendall(raw);conn.shutdown(socket.SHUT_WR)
            except BrokenPipeError:pass
            buf=b''
            while len(buf)<4096:
                try:part=conn.recv(4096)
                except ConnectionResetError:break
                if not part:break
                buf+=part
        value=json.loads(buf);self.flags(value);return value
    def deny(self,raw=None):
        result=self.call(raw or self.frame());self.assertEqual(result['status'],'HOLD');return result
    def status(self):
        return self.call(d.canonical(dict(kind=c.PROTOCOL,op='status',runId=RUN,seq=0,requestId='a'*32,result='NONE'))+b'\n')
    def test_enabled_consult_and_legacy_status_separate(self):
        self.assertEqual(self.call(self.frame())['status'],'SYNTHETIC_OBSERVED')
        self.assertEqual(self.status()['seq'],0)
        self.assertEqual(self.boundary.attest()['consumed'],1)
    def test_default_off_ignores_policy_config(self):
        self.stop();(self.state/'policy-consult.json').unlink();self.start(False)
        self.deny();self.assertEqual(self.status()['status'],'TECHNICAL_READBACK')
    def test_malformed_frames_keep_service_alive(self):
        for raw in (b'bad\n',b'{}',b'{}\n{}\n',b'\xff\n',b'[]\n',b'['*1500+b'\n',self.frame()+b'\n'):
            self.deny(raw)
        self.assertEqual(self.status()['status'],'TECHNICAL_READBACK')
    def test_oversized_frame_denied(self):self.deny(b'x'*9000+b'\n')
    def test_duplicate_envelope_key_denied(self):
        raw=self.frame();self.deny(b'{"op":"consult",'+raw[1:])
    def test_unsigned_epoch_revocation_and_authority_overrides(self):
        for key,value in [('epoch',99),('revoked',[]),('authorized',True),('policyRoot','/tmp'),('clientUid',os.getuid())]:
            self.deny(self.frame(**{key:value}))
    def test_publish_and_init_not_exposed(self):
        for op in ('publish','initialize','send_guest'):self.deny(self.frame(op=op))
    def test_invalid_signature_and_noncanonical_signed_receipt(self):
        self.deny(self.frame(signature='0'*128))
        value=json.loads(self.frame());value['receipt']+=' ';self.deny(d.canonical(value)+b'\n')
    def test_receipt_binding_and_bad_run(self):
        for k,v in [('host','wrong'),('archiveSha256','f'*64),('issuer','wrong'),('keyId','wrong'),('action','send_guest')]:self.deny(self.frame(self.receipt(**{k:v})))
        self.deny(self.frame(runId='strig-cust-000000000000'))
    def test_replay_survives_clean_restart(self):
        raw=self.frame();self.assertEqual(self.call(raw)['status'],'SYNTHETIC_OBSERVED')
        self.stop();self.start();self.deny(raw);self.assertEqual(self.boundary.attest()['consumed'],1)
    def test_concurrent_double_consumption(self):
        raw=self.frame()
        with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(self.call,[raw,raw]))
        self.assertEqual(sorted(r['status'] for r in results),['HOLD','SYNTHETIC_OBSERVED'])
        self.assertEqual(self.boundary.attest()['consumed'],1)
    def test_epoch_rotation_invalidates_old_receipt(self):
        old=self.frame();self.policy['epoch']=2;self.publish();self.deny(old)
        self.assertEqual(self.call(self.frame())['status'],'SYNTHETIC_OBSERVED')
    def test_revocation_persists_after_rotation_restart(self):
        self.policy.update(epoch=2,revoked=['b'*64]);self.publish()
        self.policy.update(epoch=3,revoked=[]);self.publish();self.stop();self.start();self.deny()
    def test_expired_signed_policy(self):
        # Publish a valid short-lived snapshot, then wait only for its expiry.
        now=int(time.time());self.policy.update(epoch=2,issuedAt=now,expires=now+2);self.publish()
        while time.time()<self.policy['expires']:time.sleep(.03)
        self.deny()
    def test_deleted_state_never_auto_initializes(self):
        (self.root/'state').unlink();self.deny();self.assertFalse((self.root/'state').exists())
    def test_corrupt_state_denied(self):
        (self.root/'state').write_bytes(b'{}');self.deny()
    def test_missing_checkpoint_denied(self):
        (self.root/'checkpoint').unlink();self.deny()
    def test_pending_intent_survives_restart(self):
        d.new_file(self.root/'pending',b'interrupted-synthetic-operation')
        self.stop();self.start();self.deny();self.assertTrue((self.root/'pending').exists())
    def test_policy_state_mode_drift_denied(self):
        (self.root/'state').chmod(0o644);self.deny()
    def test_policy_state_symlink_denied(self):
        (self.root/'state').rename(self.base/'original');(self.root/'state').symlink_to(self.base/'original');self.deny()
    def test_policy_state_hardlink_denied(self):
        os.link(self.root/'state',self.base/'linked');self.deny()
    def test_config_drift_requires_restart(self):
        cfg=self.config|{'host':'changed'};(self.state/'policy-consult.json').write_bytes(d.canonical(cfg));self.deny()
    def test_config_mode_and_link_denied(self):
        config=self.state/'policy-consult.json';config.chmod(0o644);self.deny()
        config.chmod(0o600);os.link(config,self.base/'config-link');self.deny()
    def test_kernel_uid_and_gid_against_signed_policy(self):
        for field in ('clientUid','clientGid'):
            self.policy.update(epoch=self.policy['epoch']+1,clientUid=os.getuid(),clientGid=os.getgid())
            self.policy[field]+=1000;self.publish();self.deny()
    def test_daemon_config_peer_mismatch(self):
        self.stop();cfg=json.loads((self.state/'config.json').read_bytes());cfg['peerUid']+=1000
        (self.state/'config.json').write_bytes(d.canonical(cfg));self.start();self.deny()
    def test_sigkill_after_consumption_requires_socket_review(self):
        raw=self.frame();self.assertEqual(self.call(raw)['status'],'SYNTHETIC_OBSERVED')
        self.proc.kill();self.proc.wait(3);self.stop()
        # Production never auto-cleans a stale socket. Disposable test only.
        attempt=subprocess.run([sys.executable,str(HERE/'asi_custodian.py'),'serve','--state-dir',str(self.state),'--enable-synthetic-policy-consult'],capture_output=True,timeout=3)
        self.assertNotEqual(attempt.returncode,0)
        self.assertEqual(json.loads(attempt.stdout)['status'],'HOLD')
        (self.state/'custodian.sock').unlink();self.start();self.deny(raw)
    def test_sigkill_before_ack_keeps_nonce_consumed(self):
        raw=self.frame();self.stop();self.start(crash=True)
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as conn:
            conn.settimeout(5);conn.connect(str(self.state/'custodian.sock'))
            conn.sendall(raw);conn.shutdown(socket.SHUT_WR)
            self.assertEqual(conn.recv(4096),b'')
        self.assertEqual(self.proc.wait(3),-signal.SIGKILL);self.stop()
        self.assertEqual(self.boundary.attest()['consumed'],1)
        # Disposable crash fixture manually reviewed; no automatic recovery API.
        (self.state/'custodian.sock').unlink();self.start();self.deny(raw)
    def test_deleted_config_denied_no_recreation(self):
        (self.state/'policy-consult.json').unlink();self.deny();self.assertFalse((self.state/'policy-consult.json').exists())
    def test_legacy_append_still_default_off(self):
        raw=d.canonical(dict(kind=c.PROTOCOL,op='append',runId=RUN,seq=1,requestId='a'*32,result='OBSERVED'))+b'\n'
        self.assertEqual(self.deny(raw)['reason'],'APPEND_DISABLED')

if __name__=='__main__':unittest.main(verbosity=2)
