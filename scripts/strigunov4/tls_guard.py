"""Scoped, pinned public Supabase CA; authenticated PostgreSQL STARTTLS probes.
No passwords, SQL, global trust changes or disabled certificate verification.
"""
import hashlib
from pathlib import Path
import re
import socket
import ssl
import subprocess
import tempfile
from contextlib import contextmanager

CA_SHA256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7'
SYSTEM_CA = Path('/etc/ssl/certs/ca-certificates.crt')

def ca_bytes():
    data = Path(__file__).with_name('prod-ca-2021.crt').read_bytes()
    if hashlib.sha256(data).hexdigest() != CA_SHA256 or b'PRIVATE KEY' in data:
        raise ValueError('CA integrity failure')
    return data

@contextmanager
def bundle():
    data = SYSTEM_CA.read_bytes() + b'\n' + ca_bytes()
    with tempfile.TemporaryDirectory(prefix='strigunov4-ca-') as tmp:
        path = Path(tmp) / 'roots.pem'
        path.write_bytes(data)
        path.chmod(0o600)
        yield str(path)

def classify(text):
    match = re.search(r'verify error:num=(\d+)', text)
    code = int(match.group(1)) if match else None
    labels = {9:'CERT_NOT_YET_VALID',10:'CERT_EXPIRED',18:'SELF_SIGNED_LEAF',
              19:'UNTRUSTED_CHAIN',20:'ISSUER_NOT_FOUND',21:'CHAIN_INCOMPLETE',
              62:'HOSTNAME_MISMATCH',79:'INVALID_CA',92:'CA_KEY_USAGE'}
    return {'category':labels.get(code,'TLS_OR_TRANSPORT'),'verify_code':code}

def probe(env, cafile):
    host, port = env['PGHOST'], env['PGPORT']
    clean = {k:env[k] for k in ('PATH','LANG','LC_ALL') if k in env}
    args = ['openssl','s_client','-starttls','postgres','-connect',host+':'+port,
            '-servername',host,'-verify_hostname',host,'-verify_return_error',
            '-CAfile',str(cafile),'-showcerts']
    try:
        r = subprocess.run(args,input='',env=clean,capture_output=True,text=True,timeout=25)
    except subprocess.TimeoutExpired:
        return {'status':'BLOCK','category':'TIMEOUT'}
    except OSError:
        return {'status':'BLOCK','category':'CLIENT_UNAVAILABLE'}
    combined=r.stdout+'\n'+r.stderr
    hashes=[]
    for pem in re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----',r.stdout,re.S):
        try: hashes.append(hashlib.sha256(ssl.PEM_cert_to_DER_cert(pem)).hexdigest())
        except (ValueError,ssl.SSLError): pass
    verified = r.returncode==0 and ('Verify return code: 0 (ok)' in combined or 'Verification: OK' in combined)
    return {'status':'PASS' if verified else 'BLOCK',
            **({'category':'CHAIN_AND_HOSTNAME_VERIFIED'} if verified else classify(combined)),
            'peer_certificate_sha256':hashes}

def diagnose(env,cafile):
    try:
        addresses=socket.getaddrinfo(env['PGHOST'],int(env['PGPORT']),type=socket.SOCK_STREAM)
        dns={'status':'PASS','ipv4':any(x[0]==socket.AF_INET for x in addresses),
             'ipv6':any(x[0]==socket.AF_INET6 for x in addresses)}
    except OSError:
        return {'status':'BLOCK','dns':{'status':'BLOCK','category':'DNS'}}
    before=probe(env,SYSTEM_CA)
    after=probe(env,cafile)
    return {'status':after['status'],'endpoint_kind':'pooler' if '.pooler.' in env['PGHOST'] else 'direct',
            'dns':dns,'system_ca':before,'scoped_ca':after,'added_ca_sha256':CA_SHA256}
