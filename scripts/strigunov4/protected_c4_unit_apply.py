"""Read-only G1 physical witness on the owner-approved Beget isolated lab.

No GitHub writes, production/DB operations, server mutation, password retrieval
or provider calls. Historical Hetzner receipt stays in GitHub issue #511.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

HOST = "pqukibofpo"
IP = "31.129.96.181"
HOST_KEY = "AAAAC3NzaC1lZDI1NTE5AAAAIKdj5raImDTKyz9C/vwYUKFwNP6V91NPcYmwfWElZoZC"
RELEASE = "d912aec6663de90e5ca4293cc5a69e2e0ed9ff94"
UNIT_SHA = "4945ca55cef36015efbaad4d83235add1e01d3a3442f3ee5cd0b0b9dca3fe624"
ROOT = "/var/www/asi-staging"
WITNESS_USER = "asi-g1-witness"
WITNESS_SHA256 = "6019fe068d5e4fc22a14d42740ad1e58842dd6ebc199253bf81917db4c098808"
NO_SEND = {
    "EMAIL_AUTO_SEND": "false",
    "EMAIL_DRAFT_ONLY": "true",
    "DRY_RUN_TELEGRAM_OUTBOUND": "true",
    "ALLOW_REAL_TELEGRAM_SYNTHETIC": "false",
    "YOOKASSA_ENABLED": "false",
    "ASI_SYNTHETIC_NO_SEND": "YES",
    "ASI_APP_ROOT": ROOT + "/current",
}
FIELDS = {"status", "hostname", "pid", "invocationId", "unitHash", "releaseSha",
          "noSendEffective", "health", "version", "reload", "nRestarts",
          "environmentMandatory", "loopbackOnly", "networkDeny",
          "kernelIngressAttached", "kernelEgressAttached", "bootDisabled",
          "actualEgressAttempted"}


def require(value, code):
    if not value:
        raise ValueError(code)


def validate_report(data):
    require(type(data) is dict and set(data) == FIELDS, "BEGET_REPORT_SHAPE")
    require(data["status"] == "BEGET_G1_ISOLATED_PROCESS_OBSERVED", "BEGET_REPORT_STATUS")
    require(data["hostname"] == HOST and type(data["pid"]) is int and 1 < data["pid"] < 4194304, "BEGET_IDENTITY")
    require(type(data["invocationId"]) is str and re.fullmatch(r"[0-9a-f]{32}", data["invocationId"]) and data["unitHash"] == UNIT_SHA, "BEGET_UNIT")
    require(data["releaseSha"] == RELEASE, "BEGET_RELEASE")
    require(data["health"] == 200 and data["version"] == 200 and data["reload"] == "no"
            and data["nRestarts"] == 0, "BEGET_HEALTH")
    for name in ("noSendEffective", "environmentMandatory", "loopbackOnly",
                 "networkDeny", "kernelIngressAttached", "kernelEgressAttached", "bootDisabled"):
        require(data[name] is True, "BEGET_GUARD_" + name.upper())
    require(data["actualEgressAttempted"] is False, "UNAPPROVED_NETWORK_PROBE")
    return True


# Fixed, read-only remote script. Never prints process environment or HTTP bodies.
REMOTE = r'''
import hashlib,json,os,pathlib,re,stat,subprocess,urllib.request
root=pathlib.Path("/var/www/asi-staging")
unit=pathlib.Path("/etc/systemd/system/asi-beget-g1-staging.service")
env=root/"shared/.env.staging.local"
release="d912aec6663de90e5ca4293cc5a69e2e0ed9ff94"
want={"EMAIL_AUTO_SEND":"false","EMAIL_DRAFT_ONLY":"true",
      "DRY_RUN_TELEGRAM_OUTBOUND":"true","ALLOW_REAL_TELEGRAM_SYNTHETIC":"false",
      "YOOKASSA_ENABLED":"false","ASI_SYNTHETIC_NO_SEND":"YES",
      "ASI_APP_ROOT":"/var/www/asi-staging/current"}
def run(*args):
 return subprocess.check_output(args,text=True,timeout=8,stderr=subprocess.DEVNULL)
def show():
 props=("MainPID","User","Group","WorkingDirectory","EnvironmentFiles","ActiveState",
        "NRestarts","InvocationID","NeedDaemonReload","UnitFileState",
        "IPAddressDeny","IPAddressAllow")
 data={}
 for line in run("systemctl","show","asi-beget-g1-staging.service",*[("-p"+p) for p in props]).splitlines():
  k,v=line.split("=",1)
  assert k not in data
  data[k]=v
 return data
m=show()
pid=int(m["MainPID"])
assert os.uname().nodename=="pqukibofpo" and 1 < pid < 4194304
assert re.fullmatch(r"[0-9a-f]{32}",m["InvocationID"])
assert m["User"]=="asi-staging" and m["Group"]=="asi-staging"
assert m["ActiveState"]=="active" and m["WorkingDirectory"]==str(root/"current")
assert m["EnvironmentFiles"]==str(env)+" (ignore_errors=no)"
assert m["NRestarts"]=="0" and m["NeedDaemonReload"]=="no"
assert m["UnitFileState"]=="disabled"
assert m["IPAddressDeny"]=="0.0.0.0/0 ::/0"
assert set(m["IPAddressAllow"].split())=={"127.0.0.0/8","::1/128"}
assert (root/"current").resolve()==root/"releases"/release
assert json.loads((root/"current/release-meta.json").read_text())=={"gitSha":release}
es=env.stat()
assert stat.S_ISREG(es.st_mode) and es.st_uid==0
assert stat.S_IMODE(es.st_mode) in (0o600,0o640)
vals={}
for row in (pathlib.Path("/proc")/str(pid)/"environ").read_bytes().split(b"\0"):
 if b"=" not in row:continue
 k,v=row.split(b"=",1)
 if k.decode("ascii","replace") in want:
  k=k.decode("ascii")
  assert k not in vals
  vals[k]=v.decode("utf8","replace")
assert vals==want
unit_hash=hashlib.sha256(unit.read_bytes()).hexdigest()
assert unit_hash=="4945ca55cef36015efbaad4d83235add1e01d3a3442f3ee5cd0b0b9dca3fe624"
programs=run("bpftool","cgroup","show",
 "/sys/fs/cgroup/system.slice/asi-beget-g1-staging.service")
assert re.search(r"cgroup_inet_ingress\s+multi\s+sd_fw_ingress",programs)
assert re.search(r"cgroup_inet_egress\s+multi\s+sd_fw_egress",programs)
# HTTP only localhost, no redirects, bounded JSON body, no credentials.
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):raise ValueError("REDIRECT")
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
results={}
for name in ("health","version"):
 with opener.open("http://127.0.0.1:3001/api/"+name,timeout=5) as f:
  assert f.status==200
  raw=f.read(65537)
  assert len(raw)<=65536
  results[name]=json.loads(raw)
assert results["health"]["ok"] is True
v=results["version"]
assert v["environment"]=="staging" and v["sha"]==release
assert v["resolvedReleasePath"]==str(root/"releases"/release)
def loopback_listener_only(text):
 rows=[line.split() for line in text.splitlines() if line.strip()]
 if not rows or any(len(row)<5 or row[0]!="LISTEN" for row in rows):
  return False
 port3001=[row[3] for row in rows if row[3].rsplit(":",1)[-1]=="3001"]
 return port3001==["127.0.0.1:3001"]
listen=run("ss","-Hltn")
assert loopback_listener_only(listen)
assert show()["MainPID"]==str(pid) and show()["InvocationID"]==m["InvocationID"]
print(json.dumps({"status":"BEGET_G1_ISOLATED_PROCESS_OBSERVED",
 "hostname":os.uname().nodename,"pid":pid,"invocationId":m["InvocationID"],
 "unitHash":unit_hash,"releaseSha":release,"noSendEffective":True,
 "health":200,"version":200,"reload":"no","nRestarts":0,
 "environmentMandatory":True,"loopbackOnly":True,"networkDeny":True,
 "kernelIngressAttached":True,"kernelEgressAttached":True,"bootDisabled":True,
 "actualEgressAttempted":False},sort_keys=True))
'''


def protected_context(env):
    require(env.get("GITHUB_REPOSITORY") == "ASI-integration/asi-landing", "WRONG_REPOSITORY")
    require(env.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "NOT_DISPATCH")
    require(env.get("GITHUB_REF") == "refs/heads/main", "NOT_MAIN")
    require(env.get("GITHUB_ACTOR_ID") == "207600140" and
            env.get("GITHUB_TRIGGERING_ACTOR") == "ASI-integration", "NOT_OWNER")
    require(env.get("GITHUB_RUN_ATTEMPT") == "1", "RERUN_FORBIDDEN")
    require(env.get("GITHUB_WORKFLOW_REF") ==
            "ASI-integration/asi-landing/.github/workflows/strigunov4-c4-unit-apply.yml@refs/heads/main",
            "WRONG_WORKFLOW")
    sha = env.get("GITHUB_SHA", "")
    require(re.fullmatch(r"[a-f0-9]{40}", sha) and sha == env.get("GITHUB_WORKFLOW_SHA"),
            "SHA_IDENTITY")
    require(subprocess.check_output(["git","rev-parse","HEAD"],text=True,timeout=7).strip() == sha,
            "SOURCE_MISMATCH")
    require(env.get("G1_PHYSICAL_TARGET") == "beget-g1-readonly", "TARGET_INVALID")
    require(env.get("BEGET_SSH_HOST") == IP and env.get("BEGET_SSH_USER") == WITNESS_USER
            and env.get("BEGET_SSH_PORT") == "22", "BEGET_SSH_TARGET")
    key = env.get("BEGET_SSH_PRIVATE_KEY", "")
    require(key.startswith("-----BEGIN OPENSSH PRIVATE KEY-----") and len(key) < 16000,
            "BEGET_KEY_MISSING")
    return key


def execute():
    key = protected_context(os.environ)
    require(hashlib.sha256(REMOTE.encode("utf8")).hexdigest() == WITNESS_SHA256,
            "WITNESS_SOURCE_DRIFT")
    with tempfile.TemporaryDirectory() as folder:
        base = Path(folder)
        private, known = base/"access", base/"known_hosts"
        private.write_text(key.rstrip()+"\n", encoding="ascii")
        os.chmod(private,0o600)
        known.write_text(IP+" ssh-ed25519 "+HOST_KEY+"\n", encoding="ascii")
        os.chmod(known,0o600)
        command=["ssh","-F","/dev/null","-o","BatchMode=yes","-o","IdentitiesOnly=yes",
                 "-o","StrictHostKeyChecking=yes","-o","GlobalKnownHostsFile=/dev/null",
                 "-o","UserKnownHostsFile="+str(known),"-o","ConnectTimeout=12",
                 "-o","ProxyCommand=none","-o","ClearAllForwardings=yes",
                 "-i",str(private),"-p","22",WITNESS_USER+"@"+IP]
        # The server key has restrict+forced-command; no remote command or
        # code passes through SSH, only the installed root-owned witness runs.
        result=subprocess.run(command,stdin=subprocess.DEVNULL,text=True,
                              capture_output=True,timeout=65)
        require(result.returncode==0 and 10<len(result.stdout)<4096,"BEGET_SSH_READ_FAILED")
        try:
            data=json.loads(result.stdout.strip())
        except ValueError:
            raise ValueError("BEGET_REMOTE_JSON_INVALID") from None
        validate_report(data)
    print("BEGET_G1_PHYSICAL_READONLY_WITNESS_PASS; HOST_PINNED; PROCESS_STABLE; "
          "NO_SEND_7; SYSTEMD_KERNEL_FILTERS_ATTACHED; NO_NETWORK_PROBE_OR_HOST_WRITES")


if __name__=="__main__":
    try:
        execute()
    except Exception as exc:
        reason=str(exc)
        if not re.fullmatch(r"[A-Z0-9_]{1,96}",reason):
            reason="UNTRUSTED_OR_INVALID_PHYSICAL_EVIDENCE"
        print("BEGET_G1_PROTECTED_WITNESS_BLOCKED:"+reason,file=sys.stderr)
        sys.exit(1)
