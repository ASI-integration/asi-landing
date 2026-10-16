import contextlib
import io
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
import tls_guard
import audit

class TLSGuards(unittest.TestCase):
    def test_ca_pin_and_tampering(self):
        self.assertIn(b'BEGIN CERTIFICATE',tls_guard.ca_bytes())
        with patch.object(Path,'read_bytes',return_value=b'untrusted'):
            with self.assertRaises(ValueError):tls_guard.ca_bytes()
    def test_scoped_bundle_cleaned(self):
        with tls_guard.bundle() as name:
            self.assertEqual(Path(name).stat().st_mode & 0o777,0o600)
            self.assertIn(tls_guard.ca_bytes(),Path(name).read_bytes())
        self.assertFalse(Path(name).exists())
    def test_failure_categories_no_peer_details(self):
        for code,label in [(20,'ISSUER_NOT_FOUND'),(62,'HOSTNAME_MISMATCH'),(10,'CERT_EXPIRED'),(92,'CA_KEY_USAGE')]:
            result=tls_guard.classify(f'verify error:num={code}: PRIVATE_SECRET')
            self.assertEqual(result['category'],label);self.assertNotIn('PRIVATE_SECRET',str(result))
    def test_credentials_not_sent_to_openssl(self):
        env={'PGHOST':'db.example','PGPORT':'5432','PGPASSWORD':'PRIVATE_SECRET','PATH':os.environ['PATH']}
        r=subprocess.CompletedProcess([],1,'','verify error:num=62: PRIVATE_SECRET')
        with patch('subprocess.run',return_value=r) as run:
            result=tls_guard.probe(env,'roots.pem')
            self.assertNotIn('PRIVATE_SECRET',str(run.call_args));self.assertNotIn('PRIVATE_SECRET',str(result))
            self.assertIn('-verify_hostname',run.call_args.args[0]);self.assertIn('-verify_return_error',run.call_args.args[0])
    def test_failed_tls_never_runs_sql(self):
        env={'GITHUB_REF':'refs/heads/main','GITHUB_WORKFLOW_REF':audit.WORKFLOW,'STAGING_SUPABASE_PROJECT_REF':audit.PROJECT,'STAGING_DATABASE_URL':f'postgres://postgres:x@db.{audit.PROJECT}.supabase.co/postgres'}
        with patch.dict(os.environ,env,clear=True),patch('tls_guard.diagnose',return_value={'status':'BLOCK'}),patch('audit.query') as sql,contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(audit.main(),97);sql.assert_not_called()
    def test_real_starttls_trust_and_hostname(self):
        with tempfile.TemporaryDirectory() as tmp:
            cert=Path(tmp)/'server.crt';key=Path(tmp)/'server.key'
            subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],capture_output=True,check=True)
            ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(cert,key)
            def check(host,ca):
                with socket.socket() as listener:
                    listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(8)
                    def serve():
                        try:
                            conn,_=listener.accept()
                            with conn:
                                request=b''
                                while len(request)<8:request+=conn.recv(8-len(request))
                                if request!=bytes.fromhex('0000000804d2162f'):return
                                conn.sendall(b'S')
                                with ctx.wrap_socket(conn,server_side=True) as secured:secured.recv(1)
                        except (OSError,ssl.SSLError):pass
                    thread=threading.Thread(target=serve,daemon=True);thread.start()
                    result=tls_guard.probe({'PGHOST':host,'PGPORT':str(listener.getsockname()[1]),'PATH':os.environ['PATH']},ca)
                    thread.join(9);self.assertFalse(thread.is_alive())
                    return result
            self.assertEqual(check('localhost',cert)['status'],'PASS')
            self.assertEqual(check('localhost',tls_guard.SYSTEM_CA)['status'],'BLOCK')
            self.assertEqual(check('127.0.0.1',cert)['category'],'HOSTNAME_MISMATCH')

if __name__=='__main__':unittest.main()
