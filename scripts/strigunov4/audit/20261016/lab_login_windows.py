"""Owner-machine orchestrator: secrets only in memory/encrypted bundle and lab DB.
Explicit --execute is required after parity handoff. No original passwords read.
"""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

BASE=Path(r'C:\Users\Admin\.asi\strigunov4-backup')
OPENSSL=r'C:\Program Files\Git\usr\bin\openssl.exe'
WSL=r'C:\Windows\System32\wsl.exe'
CERT_FP='6A:FA:98:2F:3E:07:37:E1:56:7E:13:BF:DB:85:8D:9E:EF:00:ED:E8:6B:48:1A:69:D7:58:A7:F3:E1:07:A7:33'


def command(args,data=None,timeout=60):
    p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    if p.returncode:
        raise RuntimeError('PRIVATE_COMMAND_FAILED')
    return p.stdout


def rpc(receiver,payload):
    data=json.dumps(payload,separators=(',',':')).encode()
    out=command([WSL,'-d','ASI-Strigunov4-Restore','--user','root','--exec','/usr/bin/python3','-c',receiver],data,180)
    return json.loads(out)


def owner_folder(path):
    # Generated path has no quotes; explicit verification before ciphertext write.
    if "'" in str(path): raise RuntimeError('PATH_BLOCK')
    ps="$ErrorActionPreference='Stop'; $p='"+str(path)+"'; if(Test-Path $p){throw 'EXISTS'}; New-Item -ItemType Directory -Path $p | Out-Null; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); Set-Acl -Path $p -AclObject $acl; $c=Get-Acl $p; if(!$c.AreAccessRulesProtected -or @($c.Access).Count -ne 1 -or $c.Access[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'ACL_BLOCK'}"
    command(['powershell.exe','-NoProfile','-NonInteractive','-Command',ps])


def main():
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('manifest',type=Path)
    a.add_argument('--receiver',required=True,type=Path)
    a.add_argument('--execute',action='store_true')
    args=a.parse_args()
    report={'credential_purpose':'recovery-issued lab credentials',
            'source_original_password_recovery':'NOT_PROVEN',
            'external_application_credential_recovery':'NOT_PROVEN',
            'full_restore_acceptance':'NOT_PROVEN','status':'BLOCK','phase':'PREPARE'}
    try:
        manifest=json.loads(args.manifest.read_text(encoding='utf-8-sig'))
        receiver=args.receiver.read_text(encoding='utf-8-sig')
        observed=rpc(receiver,{'action':'inventory','manifest':manifest})
        if observed.get('status')!='INVENTORY_VERIFIED':
            report['inventory']=observed
            raise RuntimeError('INVENTORY_BLOCK')
        roles=sorted(r['rolname'] for r in observed['baseline']['roles'] if r['rolcanlogin'])
        report.update(login_roles=roles,role_count=len(roles),container_id=manifest['container_id'],
                      nonce=manifest['nonce'],run_id='38942690625')
        if not args.execute:
            report.update(status='INVENTORY_VERIFIED',phase='NO_MUTATION')
            print(json.dumps(report,sort_keys=True)); return 0
        report['phase']='BUNDLE_PREPARATION'
        fp=command([OPENSSL,'x509','-in',str(BASE/'recipient.crt'),'-noout','-fingerprint','-sha256']).decode().strip().split('=')[-1].upper()
        if fp!=CERT_FP: raise RuntimeError('CERTIFICATE_BLOCK')
        credentials={role:secrets.token_urlsafe(32) for role in roles}
        bundle={'schema_version':1,'purpose':'recovery-issued lab credentials',
                'target':manifest,'roles':roles,'credentials':credentials}
        plaintext=json.dumps(bundle,sort_keys=True,separators=(',',':')).encode()
        encrypted=command([OPENSSL,'cms','-encrypt','-binary','-aes256','-outform','DER','-recip',str(BASE/'recipient.crt')],plaintext)
        folder=BASE/('login-credentials-'+manifest['nonce']+'-'+secrets.token_hex(8))
        owner_folder(folder)
        file=folder/'recovery-issued-lab-credentials.cms'
        with file.open('xb') as f:
            f.write(encrypted); f.flush(); os.fsync(f.fileno())
        # Existing key receives persisted bytes, not transient ciphertext copy.
        readback=file.read_bytes()
        decrypted=command([OPENSSL,'cms','-decrypt','-binary','-inform','DER','-inkey',str(BASE/'private.key'),'-recip',str(BASE/'recipient.crt')],readback)
        if not hmac.compare_digest(decrypted,plaintext) or json.loads(decrypted)['roles']!=roles:
            raise RuntimeError('BUNDLE_ROUNDTRIP_BLOCK')
        report.update(encrypted_bundle=str(file),encrypted_bundle_sha256=hashlib.sha256(readback).hexdigest(),
                      encrypted_bundle_bytes=len(readback),owner_only_bundle_directory=True,
                      encrypted_bundle_recovery_verified=True,plaintext_credential_files=0)
        report['phase']='MUTATION_DISPATCHED'
        outcome=rpc(receiver,{'action':'mutate','manifest':manifest,
            'baseline':observed['baseline'],'credentials':credentials})
        report['outcome']=outcome
        report['phase']='VALIDATION_RETURNED'
        report['status']='LOGIN_CHECKS_RECORDED' if outcome.get('status')=='LOGIN_CHECKS_RECORDED' and outcome.get('all_logins_pass') is True else 'BLOCK'
    except Exception:
        report['reason']='PRIVATE_LOGIN_WORKFLOW_BLOCK'
    out=BASE/'strigunov4-recovery-issued-login-38942690625.json'
    out.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,sort_keys=True))
    return 0 if report['status']=='LOGIN_CHECKS_RECORDED' else 2


if __name__=='__main__':
    raise SystemExit(main())
