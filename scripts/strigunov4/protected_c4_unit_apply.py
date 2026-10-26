"""Fail-closed, read-only, run-bound live physical G1 witness for the approved lab.

Only callable by the protected staging GitHub Actions workflow. It never applies
units, mutates databases, dispatches messages, or promotes the release.
"""
import hashlib
import ipaddress
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

LAB_HOST = "asi-pilot-lab-01"
LAB_IP = "65.21.249.108"
EXPECTED_RELEASE = "d912aec6663de90e5ca4293cc5a69e2e0ed9ff94"
UNIT_SHA = "6e0ce12922e015738368c89deeef154c195f19b2a0678d72d27d58e5414bf62c"
WITNESS_SHA = "4effee726a0ce0a380d547ba9566f8e3007445f9aad9861a5bd4bb4ad59f0124"
OLD_UNIT_SHA = "9072dd1a276c7bea2bb7d17031a51b250177e2806cd632e26728028c0a8a01d9"
OLD_PID = 2888990
LAB_PINNED_HOST_KEY = "AAAAC3NzaC1lZDI1NTE5AAAAIJ10iClje1wNmIQXj4/QvJi4JsIfD6aocP2IazK5K3RG"
JUMP_PINNED_HOST_KEY = "AAAAC3NzaC1lZDI1NTE5AAAAIEW5esNrmjSORIF1DVyyaBY5v5ObBDCiNjdLPbHQGC9H"

NO_SEND = {
    "EMAIL_AUTO_SEND": "false",
    "EMAIL_DRAFT_ONLY": "true",
    "DRY_RUN_TELEGRAM_OUTBOUND": "true",
    "ALLOW_REAL_TELEGRAM_SYNTHETIC": "false",
    "YOOKASSA_ENABLED": "false",
    "ASI_SYNTHETIC_NO_SEND": "YES",
    "ASI_APP_ROOT": "/var/www/asi-staging/current",
}


def require(ok, code):
    if not ok:
        raise ValueError(code)


def validate_lab_report(data):
    require(type(data) is dict and set(data) == {"hostname", "pid", "invocationId", "unitHash", "witnessHash", "releaseSha", "noSendEffective", "egressBlocked", "health", "version", "reload", "enabledAtBoot"}, "LAB_REPORT_SHAPE")
    require(data["hostname"] == LAB_HOST and type(data["pid"]) is int and data["pid"] == 250151, "LAB_HOST_PID")
    require(data["invocationId"] == "f9713b4e2fcd46d2967b8cdf7c9678db", "LAB_INVOCATION_CHANGED")
    require(data["unitHash"] == UNIT_SHA and data["witnessHash"] == WITNESS_SHA, "LAB_DIGEST")
    require(data["releaseSha"] == EXPECTED_RELEASE, "LAB_RELEASE")
    require(data["noSendEffective"] is True and data["egressBlocked"] is True, "LAB_NO_SEND")
    require(data["health"] == 200 and data["version"] == 200 and data["reload"] == "no", "LAB_HEALTH")
    require(data["enabledAtBoot"] is False, "LAB_AUTOSTART")
    return True


def validate_old_report(data):
    require(type(data) is dict and set(data) == {"hostname", "pid", "unitHash", "health", "reload", "environmentOptional"}, "OLD_REPORT_SHAPE")
    require(data["hostname"] == "asi-agent-runner", "OLD_HOST")
    require(data["pid"] == OLD_PID and data["unitHash"] == OLD_UNIT_SHA, "OLD_STAGE_DRIFT")
    require(data["health"] == 200 and data["reload"] == "no" and data["environmentOptional"] is True, "OLD_STAGE_CHANGED")
    return True


# Remote scripts are hardcoded and passed over SSH standard input. No user-provided command strings.
REMOTE_LAB = r'''
import os,hashlib,json,pathlib,subprocess,urllib.request
def show(k):
 return subprocess.check_output(["systemctl","show","asi-landing-staging.service","--value","-p",k],text=True,timeout=7).strip()
def check(cmd):
 subprocess.check_call(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=7)
rel="d912aec6663de90e5ca4293cc5a69e2e0ed9ff94"
expect={"EMAIL_AUTO_SEND":"false","EMAIL_DRAFT_ONLY":"true","DRY_RUN_TELEGRAM_OUTBOUND":"true","ALLOW_REAL_TELEGRAM_SYNTHETIC":"false","YOOKASSA_ENABLED":"false","ASI_SYNTHETIC_NO_SEND":"YES","ASI_APP_ROOT":"/var/www/asi-staging/current"}
p=int(show("MainPID"))
assert os.uname().nodename=="asi-pilot-lab-01" and p==250151
assert show("ActiveState")=="active" and show("NRestarts")=="0"
assert show("InvocationID")=="f9713b4e2fcd46d2967b8cdf7c9678db"
env=show("EnvironmentFiles")
assert "/var/www/asi-staging/shared/.env.staging.local" in env and "ignore_errors=yes" not in env
unitHash=hashlib.sha256(pathlib.Path("/etc/systemd/system/asi-landing-staging.service").read_bytes()).hexdigest()
witness=pathlib.Path("/root/asi-s4-g1-physical-witness-20261025.json").read_bytes()
witnessHash=hashlib.sha256(witness).hexdigest()
w=json.loads(witness)
assert w["status"]=="G1_LAB_PHYSICAL_PROOF_PASS_NOT_ACCEPTED" and w["ownerAcceptance"] is False and w["nextStageReleased"] is False
entries={}
for row in pathlib.Path("/proc/"+str(p)+"/environ").read_bytes().split(b"\0"):
 if b"=" in row:
  k,v=row.split(b"=",1);k=k.decode("utf-8","replace")
  if k in expect:entries[k]=v.decode("utf-8","replace")
noSend=(entries==expect)
check(["iptables","-C","OUTPUT","-m","owner","--uid-owner","asi-runtime","!","-d","127.0.0.0/8","-j","REJECT"])
check(["ip6tables","-C","OUTPUT","-m","owner","--uid-owner","asi-runtime","!","-d","::1/128","-j","REJECT"])
with urllib.request.urlopen("http://127.0.0.1:3001/api/health",timeout=5) as f:
 assert f.status==200 and json.load(f)["ok"] is True
with urllib.request.urlopen("http://127.0.0.1:3001/api/version",timeout=5) as f:
 version=json.load(f)
 assert f.status==200 and version["environment"]=="staging"
 assert version["resolvedReleasePath"]=="/var/www/asi-staging/releases/"+rel
 assert version["sha"]==rel
print(json.dumps({"hostname":os.uname().nodename,"pid":p,"invocationId":show("InvocationID"),
 "unitHash":unitHash,"witnessHash":witnessHash,"releaseSha":rel,"noSendEffective":noSend,
 "egressBlocked":True,"health":200,"version":200,"reload":show("NeedDaemonReload"),
 "enabledAtBoot":show("UnitFileState")=="enabled"}))
'''

REMOTE_OLD = r'''
import os,hashlib,json,pathlib,subprocess,urllib.request
def show(k):
 return subprocess.check_output(["systemctl","show","asi-landing-staging.service","--value","-p",k],text=True,timeout=7).strip()
assert os.uname().nodename=="asi-agent-runner"
u=hashlib.sha256(pathlib.Path("/etc/systemd/system/asi-landing-staging.service").read_bytes()).hexdigest()
env=show("EnvironmentFiles")
with urllib.request.urlopen("http://127.0.0.1:3001/api/health",timeout=5) as f:
 assert f.status==200 and json.load(f)["ok"] is True
print(json.dumps({"hostname":os.uname().nodename,"pid":int(show("MainPID")),"unitHash":u,
 "health":200,"reload":show("NeedDaemonReload"),"environmentOptional":"ignore_errors=yes" in env}))
'''


def execute():
    # Must match dispatch owner, exact checked-out source, immutable protected run.
    env = os.environ
    require(env.get("GITHUB_REPOSITORY") == "ASI-integration/asi-landing", "WRONG_REPOSITORY")
    require(env.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "NOT_PROTECTED_DISPATCH")
    require(env.get("GITHUB_REF") == "refs/heads/main", "NOT_MAIN")
    require(env.get("GITHUB_ACTOR_ID") == "207600140" and env.get("GITHUB_TRIGGERING_ACTOR") == "ASI-integration", "NOT_OWNER")
    require(env.get("GITHUB_RUN_ATTEMPT") == "1", "RERUN_FORBIDDEN")
    require(env.get("GITHUB_WORKFLOW_REF") == "ASI-integration/asi-landing/.github/workflows/strigunov4-c4-unit-apply.yml@refs/heads/main", "WRONG_WORKFLOW")
    sha = env.get("GITHUB_SHA","")
    require(re.fullmatch("[a-f0-9]{40}",sha) and sha == env.get("GITHUB_WORKFLOW_SHA"), "SHA_IDENTITY")
    require(subprocess.check_output(["git","rev-parse","HEAD"],text=True,timeout=7).strip() == sha,"SOURCE_MISMATCH")
    host=env.get("STAGING_SSH_HOST","")
    user=env.get("STAGING_SSH_USER","")
    port=env.get("STAGING_SSH_PORT","22")
    secret=env.get("STAGING_SSH_PRIVATE_KEY","")
    require(re.fullmatch(r"[A-Za-z0-9.-]{1,253}",host) and not host.startswith("-"),"STAGING_HOST")
    require(re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}",user), "STAGING_USER")
    require(port.isascii() and port.isdecimal() and 1<=int(port)<=65535,"STAGING_PORT")
    require("PRIVATE KEY" in secret and len(secret)<16000, "STAGING_PRIVATE_KEY_ABSENT")
    with tempfile.TemporaryDirectory() as folder:
        root=pathlib.Path(folder)
        private=root/"access"
        private.write_text(secret.rstrip()+"\n",encoding="ascii")
        os.chmod(private,0o600)
        known=root/"known_hosts"
        known.write_text("asi-hop ssh-ed25519 "+JUMP_PINNED_HOST_KEY+"\n"+"asi-lab ssh-ed25519 "+LAB_PINNED_HOST_KEY+"\n")
        conf=root/"ssh_config"
        conf.write_text(f"""Host asi-hop
  HostName {host}
  User {user}
  Port {port}
  IdentityFile {private}
  IdentitiesOnly yes
  HostKeyAlias asi-hop
  UserKnownHostsFile {known}
  StrictHostKeyChecking yes
  BatchMode yes
  ConnectTimeout 12
Host asi-lab
  HostName {LAB_IP}
  User root
  Port 22
  IdentityFile {private}
  IdentitiesOnly yes
  ProxyJump asi-hop
  HostKeyAlias asi-lab
  UserKnownHostsFile {known}
  StrictHostKeyChecking yes
  BatchMode yes
  ConnectTimeout 12
""")
        os.chmod(conf,0o600)
        def inspect(alias, script, checker):
            result=subprocess.run(["ssh","-F",str(conf),"-T",alias,"python3","-B","-"],input=script,text=True,capture_output=True,timeout=42)
            require(result.returncode == 0 and len(result.stdout)<4096 and len(result.stdout)>10,"PROTECTED_SSH_READ_FAILED:"+alias.upper())
            try:
                report=json.loads(result.stdout.strip())
            except ValueError:
                raise ValueError("PROTECTED_SSH_INVALID_JSON:"+alias.upper()) from None
            checker(report)
        inspect("asi-lab",REMOTE_LAB,validate_lab_report)
        inspect("asi-hop",REMOTE_OLD,validate_old_report)
    print("S4_G1_PROTECTED_PHYSICAL_WITNESS_PASS; SHA_BOUND; LAB_AND_OLD_STAGING_INDEPENDENT; NO_SERVER_WRITES")


def safe_failure_reason(error):
    """Return only fixed-shape diagnostics; never expose remote output or secrets."""
    reason=str(error)
    return reason if re.fullmatch(r"[A-Z0-9_:-]{1,128}",reason) else "UNTRUSTED_OR_INVALID_PHYSICAL_EVIDENCE"


if __name__ == "__main__":
    try:
        execute()
    except Exception as exc:
        print("S4_G1_PROTECTED_PHYSICAL_WITNESS_BLOCKED:"+safe_failure_reason(exc),file=sys.stderr)
        sys.exit(1)
