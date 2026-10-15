"""Real accepted-socket boundary probe on a disposable hosted runner only.
The root CI supervisor owns synthetic signer files; service/client run nonroot.
"""
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import durable_policy as d

SERVICE = r'''
import json,os,socket,sys
from pathlib import Path
import durable_policy as d
p=Path(sys.argv[1]);config=json.loads((p/'config').read_text());key=(p/'public').read_bytes()
b=d.Boundary(p/'service'/'state',key,**config);b.initialize()
b.publish((p/'policy').read_bytes(),(p/'policy.sig').read_bytes())
with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
 s.bind(str(p/'service'/'socket'));os.chmod(p/'service'/'socket',0o666);s.listen(1);s.settimeout(5)
 with s.accept()[0] as c:
  try:r=b.consume(c,(p/'receipt').read_bytes(),(p/'receipt.sig').read_bytes())
  except d.Hold as e:r=dict(status='HOLD',reason=str(e),**d.FLAGS)
  c.sendall(json.dumps(r).encode())
'''
CLIENT = r'''
import socket,sys
with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as c:
 c.settimeout(5);c.connect(sys.argv[1]);print(c.recv(2048).decode())
'''
class CrossBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if (os.getuid()!=0 or os.environ.get('CI')!='true'
                or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted'
                or os.environ.get('STRIGUNOV_SYNTHETIC_ONLY')!='YES'):
            raise RuntimeError('HOSTED_SYNTHETIC_ONLY')
        cls.uid=int(os.environ['SUDO_UID']);cls.gid=int(os.environ['SUDO_GID'])
        cls.client=pwd.getpwnam('nobody')
        if cls.uid<=0 or cls.uid==cls.client.pw_uid or cls.gid==cls.client.pw_gid:raise RuntimeError('DISTINCT_IDENTITIES_REQUIRED')
    @staticmethod
    def identity(uid,gid):
        def drop():os.setgroups([]);os.setgid(gid);os.setuid(uid)
        return drop
    def exercise(self, client_uid, client_gid):
        with tempfile.TemporaryDirectory(prefix='durable-peer-') as tmp:
            p=Path(tmp);p.chmod(0o755)
            shutil.copyfile(Path(__file__).with_name('durable_policy.py'),p/'durable_policy.py')
            (p/'durable_policy.py').chmod(0o644)
            service=p/'service';service.mkdir(mode=0o755);os.chown(service,self.uid,self.gid)
            state=service/'state';state.mkdir(mode=0o700);os.chown(state,self.uid,self.gid)
            subprocess.run(['openssl','genpkey','-algorithm','ED25519','-out',str(p/'private')],check=True,capture_output=True)
            (p/'private').chmod(0o600)
            subprocess.run(['openssl','pkey','-in',str(p/'private'),'-pubout','-out',str(p/'public')],check=True,capture_output=True)
            config=dict(issuer='synthetic-root-supervisor',key_id='synthetic-only',key_sha256=d.digest((p/'public').read_bytes()),host='ephemeral-ci-only',archive_sha256='a'*64,enabled=True)
            (p/'config').write_text(json.dumps(config));now=int(time.time())
            pins=dict(scope=d.SCOPE,issuer=config['issuer'],keyId=config['key_id'],keySha256=config['key_sha256'],host=config['host'],archiveSha256=config['archive_sha256'],liveAuthority=False)
            policy=pins|dict(epoch=1,issuedAt=now,expires=now+600,clientUid=self.client.pw_uid,clientGid=self.client.pw_gid,revoked=[],action='observe_synthetic')
            receipt=pins|dict(epoch=1,issuedAt=now,expires=now+50,clientUid=self.client.pw_uid,clientGid=self.client.pw_gid,action='observe_synthetic',policyDigest=d.digest(d.canonical(policy)),nonce='b'*64,seq=1)
            for name,value in [('policy',policy),('receipt',receipt)]:
                (p/name).write_bytes(d.canonical(value))
                subprocess.run(['openssl','pkeyutl','-sign','-inkey',str(p/'private'),'-rawin','-in',str(p/name),'-out',str(p/(name+'.sig'))],check=True,capture_output=True)
            env=dict(os.environ,PYTHONPATH=str(p))
            daemon=subprocess.Popen([sys.executable,'-c',SERVICE,str(p)],env=env,preexec_fn=self.identity(self.uid,self.gid),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                deadline=time.monotonic()+5
                while not (service/'socket').exists() and daemon.poll() is None and time.monotonic()<deadline:time.sleep(.02)
                result=subprocess.run([sys.executable,'-c',CLIENT,str(service/'socket')],preexec_fn=self.identity(client_uid,client_gid),capture_output=True,text=True,timeout=6)
                out,err=daemon.communicate(timeout=6)
                self.assertEqual(daemon.returncode,0,err);self.assertEqual(result.returncode,0,result.stderr)
                answer=json.loads(result.stdout)
                for flag in ('authorized','canInstall','canApprove','canSend','canIssueReceipt'):self.assertIs(answer[flag],False)
                self.assertEqual(answer['phase2'],'BLOCK')
                # Neither service nor client can read the root-owned synthetic private key.
                for uid,gid in [(self.uid,self.gid),(self.client.pw_uid,self.client.pw_gid)]:
                    probe=subprocess.run([sys.executable,'-c','import pathlib,sys;pathlib.Path(sys.argv[1]).read_bytes()',str(p/'private')],preexec_fn=self.identity(uid,gid),capture_output=True)
                    self.assertNotEqual(probe.returncode,0)
                return answer
            finally:
                if daemon.poll() is None:daemon.kill();daemon.wait(timeout=3)
    def test_real_distinct_uid_signature_consume(self):self.assertEqual(self.exercise(self.client.pw_uid,self.client.pw_gid)['status'],'SYNTHETIC_OBSERVED')
    def test_actual_wrong_uid_denied(self):self.assertEqual(self.exercise(self.uid,self.client.pw_gid)['reason'],'KERNEL_PEER_DENIED')
    def test_actual_wrong_gid_denied(self):self.assertEqual(self.exercise(self.client.pw_uid,self.gid)['reason'],'KERNEL_PEER_DENIED')
if __name__=='__main__':unittest.main(verbosity=2)
