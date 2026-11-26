#!/usr/bin/env bash
# ASI Landing #687: one-job-per-VM self-hosted runner, zero Cloud.ru effects.
# Upstream v3.3 sha256 022dca7826ce691b271f8a314f54956e07bf22c84e6ad9fabf31c1b53dc15b7e.
# The dispatcher executes only: run-one. Modes gold and run are unchanged.
# gold rebuilds the image. run registers the shared labels and can take another job.
# Does not alter ASI production services, budget, queue, owner keys or Issue #686.
set -Eeuo pipefail
umask 077

MODE="${1:-preflight}"
[[ "$MODE" == preflight || "$MODE" == gold || "$MODE" == run || "$MODE" == run-one || "$MODE" == run-one-hook ]] || { echo 'USAGE: script preflight|gold|run|run-one' >&2; exit 2; }
if [[ "$MODE" == run-one-hook ]]; then
  [[ "$(id -u)" -ne 0 ]] || { echo 'BLOCKED: HOOK_RAN_AS_ROOT' >&2; exit 97; }
  if [[ "${ASI_HOOK_EXEC_CHECK:-}" == 1 ]]; then
    [[ -w "$0" ]] && { echo 'BLOCKED: HOOK_WRITABLE_BY_RUNNER' >&2; exit 97; }
    echo "ASI_HOOK_EXEC_AS_RUNNER user=$(id -un) uid=$(id -u)"
    exit 0
  fi
  [[ "${GITHUB_RUN_ID:-}" == "${ASI_EXPECT_RUN_ID:?}" && "${GITHUB_RUN_ATTEMPT:-}" == "${ASI_EXPECT_RUN_ATTEMPT:?}" && "${GITHUB_JOB:-}" == "${ASI_EXPECT_JOB_NAME:?}" ]] || { echo 'BLOCKED: ASSIGNED_JOB_MISMATCH' >&2; exit 97; }
  if [[ "${GITHUB_EVENT_NAME:-}" == pull_request ]]; then
    [[ -n "${GITHUB_EVENT_PATH:-}" && -f "${GITHUB_EVENT_PATH}" ]] || { echo 'BLOCKED: PR_EVENT_MISSING' >&2; exit 97; }
    pr_head=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(((d.get("pull_request") or {}).get("head") or {}).get("sha") or "")' "$GITHUB_EVENT_PATH")
    merge_sha=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print((d.get("pull_request") or {}).get("merge_commit_sha") or "")' "$GITHUB_EVENT_PATH")
    [[ "$pr_head" == "${ASI_EXPECT_HEAD:?}" ]] || { echo 'BLOCKED: PR_HEAD_MISMATCH' >&2; exit 97; }
    [[ -n "$merge_sha" && "${GITHUB_SHA:-}" == "$merge_sha" ]] || { echo 'BLOCKED: MERGE_SHA_MISMATCH' >&2; exit 97; }
    [[ "${GITHUB_SHA:-}" != "$pr_head" ]] || { echo 'BLOCKED: MERGE_SHA_IS_PR_HEAD' >&2; exit 97; }
  else
    [[ "${GITHUB_SHA:-}" == "${ASI_EXPECT_HEAD:?}" ]] || { echo 'BLOCKED: HEAD_MISMATCH' >&2; exit 97; }
  fi
  echo "ASI_ASSIGNED_JOB_MATCH user=$(id -un) uid=$(id -u)"
  exit 0
fi
if [[ "$MODE" == run-one ]]; then
  [[ -n "${ASI_BINDING_FILE:-}" && -n "${ASI_AUTHORIZED_JOB_ID:-}" && -f "$ASI_BINDING_FILE" ]] || { echo 'BLOCKED: BINDING_REQUIRED' >&2; exit 2; }
  plan=$(mktemp)
  python3 - "$ASI_BINDING_FILE" "$ASI_AUTHORIZED_JOB_ID" >"$plan" <<'PY'
import json, os, re, subprocess, sys
binding = json.load(open(sys.argv[1]))
requested = int(sys.argv[2])
repo = 'ASI-integration/asi-landing'

def fail(reason):
    raise SystemExit('BLOCKED: ' + reason)

def gh(path):
    if not isinstance(path, str) or '..' in path or '-X' in path or 'registration-token' in path or any(ch.isspace() for ch in path):
        fail('GH_METHOD_BLOCKED')
    try:
        raw = subprocess.check_output(['gh', 'api', path], timeout=30)
    except subprocess.CalledProcessError:
        fail('GITHUB_UNVERIFIED')
    return json.loads(raw)

def names(labels):
    out = set()
    for label in labels or []:
        if isinstance(label, str):
            out.add(label.lower())
        elif isinstance(label, dict) and isinstance(label.get('name'), str):
            out.add(label['name'].lower())
    return out

if binding.get('repository') != repo or binding.get('jobId') != requested:
    fail('UNAUTHORIZED_JOB')
if os.environ.get('ASI_EXTRA_JOB_ID'):
    fail('UNAUTHORIZED_JOB')
head = binding.get('headSha') or ''
if not re.fullmatch(r'[a-f0-9]{40}', head):
    fail('HEAD_MISMATCH')
run_id = binding.get('runId')
attempt = binding.get('runAttempt')
job_name = binding.get('jobName') or ''
if not isinstance(run_id, int) or run_id <= 0 or not isinstance(attempt, int) or attempt <= 0:
    fail('ROUTE_MISMATCH')
if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', job_name):
    fail('ROUTE_MISMATCH')
route = f'asi-{run_id}-{attempt}-{job_name}'
if binding.get('routeLabel') != route:
    fail('ROUTE_MISMATCH')
event = binding.get('event')
if event == 'pull_request':
    pr = binding.get('prNumber')
    if not isinstance(pr, int) or pr <= 0:
        fail('HEAD_MISMATCH')
    pull = gh(f'repos/{repo}/pulls/{pr}')
    if pull.get('head', {}).get('sha') != head:
        fail('HEAD_MISMATCH')
    exact_kinds = ('CONTRACT-CHANGE', 'RELEASE-EXCEPTION', 'SECURITY-BASELINE-CHANGE')
    found = False
    for page in range(1, 11):
        comments = gh(f'repos/{repo}/issues/{pr}/comments?per_page=100&page={page}')
        if not isinstance(comments, list):
            fail('OWNER_ADMISSION_UNVERIFIED')
        for comment in comments:
            user = comment.get('user') or {}
            body = (comment.get('body') or '').strip()
            if user.get('id') == 207600140 and user.get('type') == 'User' and comment.get('author_association') == 'OWNER' and comment.get('performed_via_github_app') is None and any(body == f'ASI-OWNER-APPROVE:{kind}:{pr}:{head}' for kind in exact_kinds):
                found = True
        if len(comments) < 100:
            break
    if not found:
        fail('OWNER_ADMISSION_MISSING')
elif event == 'workflow_dispatch':
    main = gh(f'repos/{repo}/commits/main')
    if main.get('sha') != head:
        fail('HEAD_MISMATCH')
else:
    fail('EVENT_BLOCKED')
live = gh(f'repos/{repo}/actions/runs/{run_id}')
if live.get('head_sha') != head or live.get('run_attempt') != attempt:
    fail('HEAD_MISMATCH')
jobs = gh(f'repos/{repo}/actions/runs/{run_id}/jobs?per_page=100')
if not isinstance(jobs.get('jobs'), list):
    fail('JOB_NOT_QUEUED')
job = next((item for item in jobs['jobs'] if item.get('id') == requested), None)
if not job or job.get('status') != 'queued' or job.get('conclusion') or job.get('name') != job_name:
    fail('JOB_NOT_QUEUED')
job_labels = names(job.get('labels'))
common = {'linux', 'x64', 'asi-vps-onecom'}
if job_labels & (common | {'self-hosted'}):
    fail('COMMON_LABEL_BLOCK')
if job_labels != {route}:
    fail('ROUTE_MISMATCH')
runner_labels = {route}
for status in ('queued', 'in_progress', 'pending'):
    listed = gh(f'repos/{repo}/actions/runs?status={status}&per_page=20')
    for run in listed.get('workflow_runs') or []:
        if not isinstance(run.get('id'), int):
            continue
        payload = gh(f'repos/{repo}/actions/runs/{run["id"]}/jobs?per_page=100')
        for other in payload.get('jobs') or []:
            if other.get('id') == requested or other.get('status') != 'queued':
                continue
            other_labels = names(other.get('labels'))
            if other_labels and other_labels <= runner_labels:
                fail('FOREIGN_JOB_ROUTE')
safe = re.compile(r'[A-Za-z0-9_.:/,-]+')
values = {
    'HEAD': head,
    'ROUTE_LABEL': route,
    'RUN_LABELS': route,
    'ADMITTED_RUN_ID': str(run_id),
    'ADMITTED_ATTEMPT': str(attempt),
    'ADMITTED_JOB_ID': str(requested),
    'ADMITTED_JOB_NAME': job_name,
}
for key, value in values.items():
    if not safe.fullmatch(value):
        fail('PLAN_UNSAFE')
    print(f'{key}={value}')
PY
  # shellcheck disable=SC1090
  source "$plan"
  rm -f -- "$plan"
  work_base=${ASI_WORK_DIR:-/var/tmp/asi-ephemeral-dispatcher}
  [[ "$work_base" == /* && "$work_base" != / && "$work_base" != *..* ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
  WORK="${work_base}/run-${ADMITTED_RUN_ID}-${ADMITTED_ATTEMPT}-${ADMITTED_JOB_NAME}"
  echo "RUN_ONE_ADMITTED label=${RUN_LABELS} job=${ADMITTED_JOB_ID} work=${WORK}"
fi
[[ "$EUID" -ne 0 ]] || { echo 'Run as administrator, NOT as root (gh auth belongs to administrator)' >&2; exit 2; }
[[ "${ASI_PAID_CALLS_ENABLED:-NO}" == NO ]] || { echo 'BLOCKED: paid mode is enabled in shell' >&2; exit 2; }
export ASI_PAID_CALLS_ENABLED=NO ASI_GLOBAL_CAP_KOPECKS=0

REPO='ASI-integration/asi-landing'
PR=687
if [[ "$MODE" != run-one ]]; then
  HEAD='8d7f41507375264d453c44a640f78c4d8aee2700'
fi
BASE='819305a943af5b5a9354541a23a89c799057793c'
HOST_BLOCK='81.88.19.230'
OWNER_APPROVAL="ASI-OWNER-APPROVE:CONTRACT-CHANGE:${PR}:${HEAD}"
RUNNER_USER='asi-landing-kvm'
CACHE='/var/cache/asi-landing-kvm'
GOLD_DIR="$CACHE/gold-v32"
GOLD="$GOLD_DIR/ubuntu-noble-docker-nodejs-actions-runner.qcow2"
if [[ "$MODE" != run-one ]]; then
  WORK="/var/tmp/asi-landing-kvm-687-v32-${HEAD:0:12}-fetch-$MODE"
fi
IMAGE='noble-server-cloudimg-amd64.img'
IMAGE_URL="https://cloud-images.ubuntu.com/noble/current/$IMAGE"
SUMS_URL='https://cloud-images.ubuntu.com/noble/current/SHA256SUMS'
SUMSIG_URL='https://cloud-images.ubuntu.com/noble/current/SHA256SUMS.gpg'
UBUNTU_IMAGE_FPR='D2EB44626FDDC30B513D5BB71A5D6C4C7DB87C81'
PROXY_PORT=0
PROXY_PID=''
QEMU_PID=''
TOKEN_PID=''

fatal() { printf 'BLOCKED: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fatal "Missing $1. Install reviewed host packages (qemu-system-x86, qemu-utils, cloud-image-utils, gnupg, curl, python3, util-linux), then retry."; }
for cmd in gh git python3 qemu-system-x86_64 qemu-img cloud-localds curl gpg gpgv sha256sum timeout runuser sudo openssl; do need "$cmd"; done
[[ -c /dev/kvm && -r /dev/kvm && -w /dev/kvm ]] || fatal '/dev/kvm absent or not readable/writable by administrator (use sg kvm)'
if [[ "$MODE" != run-one ]]; then
  [[ "$(gh api "repos/$REPO/pulls/$PR" --jq '.head.sha')" == "$HEAD" ]] || fatal 'PR head moved; new approval required'
  [[ "$(gh api "repos/$REPO/pulls/$PR" --jq '.base.sha')" == "$BASE" ]] || fatal 'PR base moved; new attestation required'
  [[ "$(gh api "repos/$REPO/commits/main" --jq '.sha')" == "$BASE" ]] || fatal 'Protected main changed'
fi
# Refuse even preparation when the installed P1 budget ledger is not zero.
python3 - <<'PY'
import sqlite3
from pathlib import Path
p=Path('/home/administrator/asi-continuous/global-paid-spend.sqlite3')
if p.is_symlink() or not p.is_file(): raise SystemExit('BLOCKED: spend ledger missing/symlink')
with sqlite3.connect(p.resolve().as_uri()+'?mode=ro',uri=True) as db:
    cap,paused=db.execute('SELECT cap,paused FROM policy WHERE id=1').fetchone()
    n=db.execute('SELECT count(*) FROM calls').fetchone()[0]
    if (cap,paused,n)!=(0,0,0): raise SystemExit('BLOCKED: cap/paid calls not zero')
print('GLOBAL_BUDGET_ZERO_PRECHECK_PASS')
PY
# GitHub runner registration requires repo-admin permissions. Never print the auth token.
gh api "repos/$REPO/actions/runners?per_page=100" --jq '.total_count' >/dev/null || fatal 'Repository Actions runner administration permission missing'
if [[ "$MODE" != run-one ]]; then
python3 - "$REPO" "$PR" "$OWNER_APPROVAL" <<'PY'
import json,subprocess,sys
repo,num,exact=sys.argv[1],int(sys.argv[2]),sys.argv[3]
found=False
for page in range(1,11):
    comments=json.loads(subprocess.check_output(['gh','api',f'repos/{repo}/issues/{num}/comments?per_page=100&page={page}'],timeout=30))
    if any(c.get('user',{}).get('id')==207600140 and c.get('user',{}).get('type')=='User' and c.get('author_association')=='OWNER' and c.get('performed_via_github_app') is None and (c.get('body') or '').strip()==exact for c in comments): found=True
    if len(comments)<100: break
if not found: raise SystemExit('BLOCKED: exact HEAD owner User attestation not yet observed')
print('OWNER_ATTESTATION_EXACT_HEAD_PRESENT')
PY
fi

# Never let a pre-existing general-purpose runner capture untrusted Landing jobs.
python3 - "$REPO" <<'PY'
import json,subprocess,sys
repo=sys.argv[1]; d=json.loads(subprocess.check_output(['gh','api',f'repos/{repo}/actions/runners?per_page=100'],timeout=30))
assert d.get('total_count',0)==len(d.get('runners',[])), 'BLOCKED: runner inventory is paginated/unverifiable'
needed={'self-hosted','linux','x64','asi-vps-onecom'}
for r in d['runners']:
    labels={x['name'].lower() for x in r.get('labels',[])}
    if needed<=labels: raise SystemExit('BLOCKED: existing matching runner: '+r['name'])
print('RUNNER_LABEL_SET_HAS_NO_EXISTING_MATCH')
PY

# Enough physical RAM for guest and host, without stopping any existing VM.
mem_kb=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
[[ "$mem_kb" =~ ^[0-9]+$ && "$mem_kb" -ge 7340032 ]] || fatal "MemAvailable ${mem_kb:-?} KiB; need >= 7 GiB; do not displace Windows VM or production"
[[ "$(df -Pk /var/tmp | awk 'END{print $4}')" -ge 52428800 ]] || fatal 'Need 50 GiB available on /var/tmp filesystem'
[[ "$(df -Pk /var/cache | awk 'END{print $4}')" -ge 2097152 ]] || fatal 'Need 2 GiB available on /var/cache filesystem'
[[ -f /usr/share/keyrings/ubuntu-cloudimage-keyring.gpg ]] || fatal 'Official Ubuntu cloud image verification keyring missing (package: ubuntu-cloudimage-keyring)'
[[ "$(openssl version 2>/dev/null | awk '{print $1}')" == 'OpenSSL' ]] || fatal 'openssl not found'
# v3 is NOT safe to run concurrently with the v2 failed guest: both consume 6 GiB.
if pgrep -u asi-landing-kvm -f 'qemu-system-x86_64.*asi-landing-kvm-687/guest-' >/dev/null 2>&1; then
  fatal 'V2_GUEST_STILL_ACTIVE: collect diagnostics, stop only the old test launcher, and verify it exited before starting gold v3'
fi
if pgrep -u asi-landing-kvm -f 'qemu-system-x86_64.*asi-landing-kvm-687-v3/gold-build/' >/dev/null 2>&1; then
  fatal 'OLDER_V3_GOLD_VM_STILL_ACTIVE: stop only old Gold v3 launcher before v3.1'
fi
if pgrep -u asi-landing-kvm -f 'qemu-system-x86_64.*asi-landing-kvm-687-v3[12]' >/dev/null 2>&1; then
  fatal 'V3_GUEST_ALREADY_ACTIVE'
fi
if [[ "$MODE" == run || "$MODE" == run-one ]] && [[ ! -f "$GOLD" ]]; then
  fatal 'GOLD_IMAGE_MISSING: first run the gold build mode, then re-run preflight'
fi
if [[ "$MODE" == run || "$MODE" == run-one ]]; then
  [[ ! -L "$GOLD" && "$(stat -c '%u:%a' "$GOLD")" == '0:444' ]] || fatal 'GOLD_IMAGE_NOT_ROOT_SEALED_0444'
  [[ "$(qemu-img info -f qcow2 "$GOLD" | sed -n 's/^virtual size:.*(\([0-9]*\) bytes).*/\1/p')" == '42949672960' ]] || fatal 'GOLD_VIRTUAL_SIZE_NOT_40G'
fi
printf 'PREFLIGHT: HEAD, owner comment, runner permissions, memory, disk, GPG keyring checked\n'
[[ "$MODE" != preflight ]] || { echo 'PREFLIGHT_ONLY: no image download, runner registration or guest boot'; exit 0; }

# Host configuration changes are isolated to a new unprivileged CI account and workdirs.
if id "$RUNNER_USER" >/dev/null 2>&1; then
  groups=$(id -nG "$RUNNER_USER")
  [[ " $groups " == *' kvm '* && " $groups " != *' sudo '* && " $groups " != *' docker '* ]] || fatal 'Existing CI user has wrong groups'
else
  sudo -n useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --groups kvm "$RUNNER_USER"
fi
[[ -w /dev/kvm || "$(stat -c %G /dev/kvm)" == 'kvm' ]] || fatal 'KVM group access not demonstrated'
if sudo -n test -e "$WORK" || sudo -n test -L "$WORK"; then fatal "Existing $WORK (no overwrite)"; fi
[[ ! -L "$CACHE" ]] || fatal 'Image cache symlink'
if sudo -n test -e "$CACHE"; then
  [[ "$(sudo -n stat -c %u "$CACHE")" == '0' ]] || fatal 'Image cache must be root-owned'
fi
sudo -n install -d -m 0755 "$CACHE"
sudo -n install -d -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0700 "$WORK"
sudo -n install -d -m 0700 "$CACHE/verify"

cleanup() {
  set +e
  if [[ -n "$QEMU_PID" ]]; then
    sudo -n pkill -TERM -u "$RUNNER_USER" -f "qemu-system-x86_64.*${WORK}" 2>/dev/null || :
    kill "$QEMU_PID" 2>/dev/null || :
    wait "$QEMU_PID" 2>/dev/null || :
  fi
  if [[ -n "$TOKEN_PID" ]]; then kill "$TOKEN_PID" 2>/dev/null || :; wait "$TOKEN_PID" 2>/dev/null || :; fi
  if [[ -n "$PROXY_PID" ]]; then kill "$PROXY_PID" 2>/dev/null || :; wait "$PROXY_PID" 2>/dev/null || :; fi
  sudo -n rm -f -- "$WORK/proxy.py" "$WORK/token_courier.py" 2>/dev/null || :
  # Keep only console, proxy-denials and host-side notes. No guest disks or seed ISOs remain.
  if sudo -n test -d "$WORK"; then
    sudo -n find "$WORK" -type f \( -name '*.qcow2' -o -name '*.iso' -o -name 'user-data' -o -name 'meta-data' \) -delete 2>/dev/null || :
  fi
}
trap cleanup EXIT INT TERM

# Download image only from Canonical and verify GPG-signed checksum using distro trust root.
# run-one boots the already sealed gold-v32 image and must not rebuild it.
if [[ "$MODE" != run-one ]]; then
if [[ ! -s "$CACHE/$IMAGE" ]]; then
  sudo -n curl -fLSs --retry 2 --max-time 1200 -o "$CACHE/$IMAGE.partial" "$IMAGE_URL"
  sudo -n mv "$CACHE/$IMAGE.partial" "$CACHE/$IMAGE"
fi
sudo -n curl -fLSs --retry 2 --max-time 120 -o "$CACHE/verify/SHA256SUMS" "$SUMS_URL"
sudo -n curl -fLSs --retry 2 --max-time 120 -o "$CACHE/verify/SHA256SUMS.gpg" "$SUMSIG_URL"
# gpgv validates against the trusted local cloud image keyring, never network-import keys.
sig_status=$(sudo -n gpgv --status-fd 1 --keyring /usr/share/keyrings/ubuntu-cloudimage-keyring.gpg \
  "$CACHE/verify/SHA256SUMS.gpg" "$CACHE/verify/SHA256SUMS" 2>/dev/null) || fatal 'Ubuntu image manifest GPG validation failed'
printf '%s\n' "$sig_status" | grep -Fq "[GNUPG:] VALIDSIG $UBUNTU_IMAGE_FPR " || fatal 'Ubuntu image signed by unexpected key'
echo 'UBUNTU_IMAGE_GPG_SIGNER_PIN_OK'
sudo -n python3 - "$CACHE/verify/SHA256SUMS" "$CACHE/$IMAGE" <<'PY'
import hashlib,sys,pathlib
manifest=pathlib.Path(sys.argv[1]).read_text().splitlines()
p=pathlib.Path(sys.argv[2]); hits=[]
for line in manifest:
    f=line.strip().split()
    if len(f)==2 and f[1].lstrip('*')==p.name and len(f[0])==64: hits.append(f[0])
assert len(hits)==1, 'SIGNED_IMAGE_HASH_NOT_UNIQUE'
h=hashlib.sha256()
with p.open('rb') as fd:
    for part in iter(lambda:fd.read(8*1024*1024),b''): h.update(part)
assert h.hexdigest()==hits[0], 'IMAGE_HASH_MISMATCH'
print('UBUNTU_24_04_CLOUD_IMAGE_GPG_SHA256_VERIFIED',h.hexdigest())
PY

# Verify official GitHub runner digest from GitHub release metadata, not a guessed hash.
runner_json=$(gh api repos/actions/runner/releases/latest)
runner_fields=$(python3 -c '
import json,sys,re
x=json.load(sys.stdin); a=[a for a in x["assets"] if re.fullmatch(r"actions-runner-linux-x64-[0-9.]+\.tar\.gz",a["name"])]
assert len(a)==1,"RUNNER_ASSET_NOT_UNIQUE"; a=a[0]
assert re.fullmatch("sha256:[a-f0-9]{64}",a.get("digest") or ""),"RUNNER_SHA256_DIGEST_UNAVAILABLE"
print(a["browser_download_url"]); print(a["digest"][7:])
' <<< "$runner_json")
RUNNER_URL=$(printf '%s\n' "$runner_fields" | sed -n '1p')
RUNNER_SHA=$(printf '%s\n' "$runner_fields" | sed -n '2p')
[[ "$RUNNER_URL" == https://github.com/actions/runner/releases/download/* && "$RUNNER_SHA" =~ ^[0-9a-f]{64}$ ]] || fatal 'Runner release metadata not trustworthy'
fi
if [[ "$MODE" == run-one ]]; then
  # The sealed image already contains the verified runner binary. Do not download or rebuild it.
  RUNNER_URL='https://github.com/actions/runner/releases/download/gold-v32-sealed/actions-runner-linux-x64.tar.gz'
  RUNNER_SHA='0000000000000000000000000000000000000000000000000000000000000000'
fi

# Only external egress is through an allowlisted host HTTP proxy at 127.0.0.1.
sudo -n tee "$WORK/proxy.py.tmp" >/dev/null <<'PY'
#!/usr/bin/env python3
import http.server,ipaddress,re,select,socket,socketserver,sys,threading,urllib.parse,time
PORT=int(sys.argv[1]); AUDIT_PATH=sys.argv[2]; DENY_IP=ipaddress.ip_address('81.88.19.230')
def audit(event,host,reason):
    host=re.sub(r'[^a-zA-Z0-9.-]','?',str(host))[:140]
    reason=re.sub(r'[^a-zA-Z0-9_]','?',str(reason))[:80]
    # Host-owned 0700 work directory; record only the destination DNS name.
    with open(AUDIT_PATH,'a',encoding='ascii') as f:
        f.write(f'{int(time.time())} {event} {host} {reason}\n')

EXACT={'github.com','api.github.com','codeload.github.com','ghcr.io','objects.githubusercontent.com',
'raw.githubusercontent.com','registry.npmjs.org','nodejs.org','archive.ubuntu.com',
'security.ubuntu.com','download.docker.com','registry-1.docker.io','auth.docker.io',
'production.cloudflare.docker.com','deb.nodesource.com','api.snapcraft.io'}
SUFFIX=('.actions.githubusercontent.com','.githubusercontent.com','.pkg.github.com',
'.github.com','.blob.core.windows.net','.docker.io','.docker.com',
'.r2.cloudflarestorage.com','.ubuntu.com','.canonical.com','.npmjs.org',
'.githubassets.com')
def upstream(host,port):
    host=host.lower().strip('.')
    if not re.fullmatch(r'[a-z0-9.-]+',host) or not (host in EXACT or any(host.endswith(s) for s in SUFFIX)):
        raise ValueError('UNAPPROVED_DOMAIN')
    # Avoid DNS rebinding: connect to the very IP which passed global-address checks.
    for family,kind,proto,canon,addr in socket.getaddrinfo(host,port,type=socket.SOCK_STREAM):
        ip=ipaddress.ip_address(addr[0])
        if not ip.is_global or ip==DENY_IP: continue
        try:
            s=socket.socket(family,kind,proto); s.settimeout(20); s.connect(addr); s.settimeout(None); return s
        except OSError:
            s.close()
    raise ValueError('NO_APPROVED_PUBLIC_IP')
def relay(left,right):
    sockets=(left,right)
    for s in sockets:s.settimeout(None)
    try:
        while True:
            ready,_,_=select.select(sockets,[],[],180)
            if not ready:break
            for src in ready:
                data=src.recv(65536)
                if not data:return
                (right if src is left else left).sendall(data)
    finally:
        right.close()
class H(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,fmt,*args): pass  # Never log signed headers or tokens.
    def deny(self):
        self.send_response(403);self.send_header('Connection','close');self.send_header('Content-Length','0');self.end_headers();self.close_connection=True
    def do_CONNECT(self):
        audit('CONNECT_RECEIVED',self.path.split(':')[0],'REQUEST')
        try:
            m=re.fullmatch(r'([A-Za-z0-9.-]+):443',self.path)
            if not m: raise ValueError('PORT_OR_HOST')
            target=upstream(m[1],443)
            audit('ALLOW_CONNECT',m[1],'TCP_443')
        except (ValueError,OSError) as exc:
            audit('DENY_CONNECT',self.path,type(exc).__name__+'_'+str(exc))
            return self.deny()
        self.connection.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
        self.close_connection=True
        try:relay(self.connection,target)
        except (OSError,TimeoutError):target.close()
    def do_GET(self): self.plain()
    def do_HEAD(self): self.plain()
    def plain(self):
        try:
            url=urllib.parse.urlsplit(self.path)
            if url.scheme!='http' or url.username or url.password or url.port not in (None,80):raise ValueError('URL')
            target=upstream(url.hostname or '',80)
            audit('ALLOW_HTTP',url.hostname or '-','TCP_80')
        except (ValueError,OSError) as exc:
            audit('DENY_HTTP',self.path.split('/')[2] if '://' in self.path else '-',type(exc).__name__+'_'+str(exc))
            return self.deny()
        target.settimeout(120)
        path=urllib.parse.urlunsplit(('', '', url.path or '/',url.query,''))
        request=f'{self.command} {path} HTTP/1.0\r\nHost: {url.hostname}\r\nConnection: close\r\n'
        for key,value in self.headers.items():
            if key.lower() in ('host','connection','proxy-connection','proxy-authorization','authorization','transfer-encoding','content-length'):continue
            if '\r' in value or '\n' in value:continue
            request+=f'{key}: {value}\r\n'
        target.sendall((request+'\r\n').encode('latin-1'))
        self.close_connection=True
        try:
            first=target.recv(65536)
            if first:
                status=first.split(b'\r\n',1)[0][:80]
                # Only public HTTP status, never payload or request headers.
                code=status.split(b' ')[1:2]
                code=code[0].decode('ascii','replace') if code else 'UNKNOWN'
                audit('UPSTREAM_HTTP_STATUS',url.hostname or '-',code)
                self.connection.sendall(first)
            else:
                audit('UPSTREAM_HTTP_EOF',url.hostname or '-','EMPTY')
            while data:=target.recv(65536):self.connection.sendall(data)
        except (OSError,TimeoutError) as exc:
            audit('UPSTREAM_HTTP_TRANSFER_ERROR',url.hostname or '-',type(exc).__name__)
        finally:target.close()
class S(socketserver.ThreadingMixIn,http.server.HTTPServer):
    daemon_threads=True;allow_reuse_address=False
    limit=threading.BoundedSemaphore(32)
    def process_request(self,request,client_address):
        if not self.limit.acquire(blocking=False):
            request.close(); return
        try:super().process_request(request,client_address)
        except BaseException:
            self.limit.release();raise
    def process_request_thread(self,request,client_address):
        try:super().process_request_thread(request,client_address)
        finally:self.limit.release()
S(('127.0.0.1',PORT),H).serve_forever()
PY
sudo -n install -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0600 "$WORK/proxy.py.tmp" "$WORK/proxy.py"
sudo -n rm -f -- "$WORK/proxy.py.tmp"
# Loopback-only; no listener bound on the server's public or private interfaces.
PROXY_PORT=$(python3 - <<'PY'
import socket
s=socket.socket();s.bind(('127.0.0.1',0)); print(s.getsockname()[1]);s.close()
PY
)
sudo -n runuser -u "$RUNNER_USER" -- python3 "$WORK/proxy.py" "$PROXY_PORT" "$WORK/proxy-domain-audit.log" & PROXY_PID=$!
sleep 3
kill -0 "$PROXY_PID" 2>/dev/null || fatal 'Allowlist proxy failed to start'

# One-shot registration token courier: token is never written into cloud-init ISO,
# QEMU argv, environment variables, or any host/guest disk files.
sudo -n tee "$WORK/token_courier.py.tmp" >/dev/null <<'PY'
#!/usr/bin/env python3
import http.server,socketserver,sys
port=int(sys.argv[1]); token=sys.stdin.readline().strip()
if not token.isascii() or not 20<=len(token)<=512: raise SystemExit('INVALID_GITHUB_TOKEN')
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*_): pass
    def do_GET(self):
        if self.path!='/registration':
            self.send_response(404);self.send_header('Content-Length','0');self.end_headers();return
        body=token.encode('ascii')
        self.send_response(200)
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers();self.wfile.write(body)
        self.server.delivered=True
class S(socketserver.TCPServer):
    allow_reuse_address=False
    delivered=False
with S(('127.0.0.1',port),H) as server:
    server.timeout=1800
    server.handle_request()
    if not server.delivered: raise SystemExit('TOKEN_NOT_DELIVERED')
PY
sudo -n install -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0600 "$WORK/token_courier.py.tmp" "$WORK/token_courier.py"
sudo -n rm -f -- "$WORK/token_courier.py.tmp"

# One-time gold builder. Contains packages and runner *binary*, NEVER a registered runner.
if [[ "$MODE" == gold ]]; then
  [[ ! -e "$GOLD" && ! -L "$GOLD" ]] || fatal 'GOLD_ALREADY_EXISTS_NO_OVERWRITE'
  sudo -n install -d -o root -g root -m 0755 "$GOLD_DIR"
  BUILD="$WORK/gold-build"
  sudo -n install -d -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0700 "$BUILD"
  sudo -n qemu-img convert -O qcow2 "$CACHE/$IMAGE" "$BUILD/disk.qcow2"
  sudo -n qemu-img resize -f qcow2 "$BUILD/disk.qcow2" 40G >/dev/null
  sudo -n chown "$RUNNER_USER:$RUNNER_USER" "$BUILD/disk.qcow2"
  sudo -n chmod 0600 "$BUILD/disk.qcow2"
  TMP=$(mktemp -d /dev/shm/asi-gold-cloud.XXXXXXXX)
  chmod 0700 "$TMP"
  python3 - "$TMP" "$RUNNER_URL" "$RUNNER_SHA" <<'GOLDPY'
import base64,pathlib,sys
OUT,URL,SHA=sys.argv[1:]; p=pathlib.Path(OUT)
bootstrap=r'''#!/usr/bin/env bash
set -Eeuo pipefail
exec >>/var/log/asi-gold-build.log 2>&1
# Always power off this *guest* on failure, including explicit exits from failed probes.
gold_failure(){
  status=$?
  trap - EXIT ERR
  if (( status != 0 )); then
    printf 'ASI_GOLD_BOOTSTRAP_FAILED_CODE=%s\n' "$status" >/dev/ttyS0 || :
    systemctl poweroff --no-block || shutdown -P now || :
  fi
}
trap gold_failure EXIT
PROXY=http://10.0.2.100:3128
export http_proxy="$PROXY" https_proxy="$PROXY" HTTP_PROXY="$PROXY" HTTPS_PROXY="$PROXY" no_proxy='localhost,127.0.0.1' NO_PROXY='localhost,127.0.0.1'
message(){ echo "ASI_GOLD_STAGE:$1" >/dev/ttyS0; }
message NETWORK_PROBES
# Bounded host-visible probes; HTTP proxy issues cannot silently stall apt.
for spec in \
 'UBUNTU_HTTP|http://archive.ubuntu.com/ubuntu/dists/noble/InRelease' \
 'GITHUB_HTTPS|https://api.github.com/' \
 'NPM_HTTPS|https://registry.npmjs.org/' \
 'NODEJS_HTTPS|https://nodejs.org/dist/index.json'; do
  name=${spec%%|*}
  url=${spec#*|}
  message "NETWORK_PROBE_BEGIN:$name"
  # Only tested fixed public addresses; sanitize diagnostic stderr to avoid leaking headers.
  if result=$(curl -sS --fail -x "$PROXY" --connect-timeout 7 --max-time 22 \
      -o /dev/null -w 'HTTP=%{http_code} CONNECT=%{http_connect} BYTES=%{size_download}' \
      "$url" 2>&1); then
    printf 'ASI_GOLD_PROBE:%s:OK:%s\n' "$name" "${result:0:240}" >/dev/ttyS0
  else
    rc=$?
    printf 'ASI_GOLD_PROBE:%s:FAIL:CURL_RC=%s:%s\n' "$name" "$rc" "${result:0:240}" >/dev/ttyS0
    message NETWORK_PROBE_FAIL
    exit 61
  fi
done
message APT_BEGIN
printf 'Acquire::http::Proxy "%s";\nAcquire::https::Proxy "%s";\nAcquire::http::Timeout "25";\nAcquire::https::Timeout "25";\n' "$PROXY" "$PROXY" >/etc/apt/apt.conf.d/90-asi-gold-proxy
mkdir -p /etc/systemd/system/docker.service.d
printf '[Service]\nEnvironment="HTTP_PROXY=%s" "HTTPS_PROXY=%s" "NO_PROXY=localhost,127.0.0.1"\n' "$PROXY" "$PROXY" >/etc/systemd/system/docker.service.d/90-asi-guest.conf
export DEBIAN_FRONTEND=noninteractive
# Bounded apt execution, no unattended upgrades in the disposable base build.
timeout 300 apt-get -o Acquire::Retries=1 update
timeout 700 apt-get -o Acquire::Retries=1 install -y --no-install-recommends docker.io nodejs npm git curl ca-certificates jq xz-utils tar
message APT_INSTALLED
systemctl daemon-reload
systemctl enable --now docker
id runner >/dev/null 2>&1 || useradd -m -s /bin/bash runner
usermod -aG docker runner
mkdir -p /opt/actions-runner
message RUNNER_DOWNLOAD
curl --fail --location --silent --show-error --retry 1 --max-time 180 -o /tmp/actions-runner.tar.gz '__URL__'
printf '%s  /tmp/actions-runner.tar.gz\n' '__SHA__' | sha256sum -c -
tar -xzf /tmp/actions-runner.tar.gz -C /opt/actions-runner
chown -R runner:runner /opt/actions-runner
rm -f /tmp/actions-runner.tar.gz
# Gold may not contain any registered runner / GitHub token / service credentials.
for secret in /opt/actions-runner/.runner /opt/actions-runner/.credentials /opt/actions-runner/.credentials_rsaparams; do
  [[ ! -e "$secret" ]] || exit 78
done
message GOLD_PACKAGES_READY
# Run seal only *after* cloud-final completes, so cloud-init clean remains effective.
cat >/usr/local/sbin/asi-gold-seal <<'SEAL'
#!/usr/bin/env bash
set -Eeuo pipefail
trap 'printf "ASI_GOLD_SEAL_FAILED\n" >/dev/ttyS0; shutdown -P now || :' ERR
test -x /opt/actions-runner/config.sh
test -x /opt/actions-runner/run.sh
systemctl is-active --quiet docker
test -n "$(command -v node)"
test -n "$(command -v git)"
test -n "$(command -v npm)"
for secret in /opt/actions-runner/.runner /opt/actions-runner/.credentials /opt/actions-runner/.credentials_rsaparams; do
  [[ ! -e "$secret" ]] || exit 79
done
rm -rf /opt/actions-runner/_work /root/.cache /tmp/actions-runner.tar.gz
cloud-init clean --logs --seed --machine-id
rm -f /var/log/asi-gold-build.log /usr/local/sbin/asi-landing-bootstrap /usr/local/sbin/asi-gold-bootstrap
rm -f /etc/systemd/system/asi-gold-seal.service
printf 'ASI_GOLD_SEALED_NO_SECRETS\n' >/dev/ttyS0
sync
shutdown -P now
SEAL
chmod 0700 /usr/local/sbin/asi-gold-seal
cat >/etc/systemd/system/asi-gold-seal.service <<'UNIT'
[Unit]
Description=Seal prebuilt ASI gold image after cloud-init final
After=cloud-final.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/asi-gold-seal
UNIT
systemctl daemon-reload
systemctl start --no-block asi-gold-seal.service
message GOLD_SEAL_SCHEDULED
'''
bootstrap=bootstrap.replace('__URL__',URL).replace('__SHA__',SHA)
assert 'REG_TOKEN' not in bootstrap
userdata='#cloud-config\nssh_pwauth: false\ndisable_root: true\nusers: [default]\nwrite_files:\n  - path: /usr/local/sbin/asi-gold-bootstrap\n    owner: root:root\n    permissions: "0700"\n    encoding: b64\n    content: '+base64.b64encode(bootstrap.encode()).decode()+'\nruncmd:\n  - [bash, /usr/local/sbin/asi-gold-bootstrap]\n'
(p/'user-data').write_text(userdata)
(p/'meta-data').write_text('instance-id: asi-gold-builder-noble-v3\nlocal-hostname: asi-landing-gold\n')
GOLDPY
  sudo -n cloud-localds "$BUILD/seed.iso" "$TMP/user-data" "$TMP/meta-data"
  rm -rf -- "$TMP"
  sudo -n chown "$RUNNER_USER:$RUNNER_USER" "$BUILD/seed.iso"
  sudo -n chmod 0600 "$BUILD/seed.iso"
  echo 'GOLD_QEMU_START: one-time package installation; serial stages are displayed below'
  sudo -n runuser -u "$RUNNER_USER" -- timeout --signal=TERM --kill-after=30s 1500 \
    qemu-system-x86_64 -machine q35,accel=kvm -cpu host -smp 4 -m 6144 \
      -nodefaults -display none -no-reboot \
      -drive "if=virtio,format=qcow2,file=$BUILD/disk.qcow2" \
      -drive "if=none,id=seed,media=cdrom,format=raw,readonly=on,file=$BUILD/seed.iso" \
      -device virtio-scsi-pci,id=scsi0 -device scsi-cd,id=ci-seed,drive=seed,bus=scsi0.0 \
      -netdev "user,id=net0,ipv6=off,restrict=on,guestfwd=tcp:10.0.2.100:3128-cmd:/usr/bin/nc.openbsd -N 127.0.0.1 $PROXY_PORT" \
      -device virtio-net-pci,netdev=net0 \
      -serial "file:$BUILD/console.log" -monitor none &
  QEMU_PID=$!
  last=''
  while kill -0 "$QEMU_PID" 2>/dev/null; do
    latest=$(sudo -n grep -E 'ASI_GOLD_(STAGE|PROBE|SEALED)' "$BUILD/console.log" 2>/dev/null | tail -n 1 || true)
    if [[ -n "$latest" && "$latest" != "$last" ]]; then echo "$latest"; last="$latest"; fi
    if sudo -n grep -Eq 'ASI_GOLD_STAGE:NETWORK_PROBE_FAIL|ASI_GOLD_BOOTSTRAP_FAILED_CODE=' "$BUILD/console.log" 2>/dev/null; then
      echo 'GOLD_FAIL_FAST: guest bootstrap failed; terminating ONLY this disposable gold builder VM'
      sudo -n pkill -TERM -u "$RUNNER_USER" -f "qemu-system-x86_64.*$BUILD/disk.qcow2" 2>/dev/null || :
      # Do not wait for outer 1500-second timer; a failed disk can never be sealed.
      break
    fi
    sleep 4
  done
  set +e; wait "$QEMU_PID"; code=$?; set -e
  QEMU_PID=''
  sudo -n tail -n 15 "$BUILD/console.log" || true
  if [[ $code != 0 ]] || ! sudo -n grep -q 'ASI_GOLD_SEALED_NO_SECRETS' "$BUILD/console.log"; then
    sudo -n tail -n 40 "$WORK/proxy-domain-audit.log" 2>/dev/null || true
    fatal "GOLD_BUILD_BLOCKED: QEMU_RC=$code, required seal milestone absent; do NOT reuse partial disk"
  fi
  sudo -n qemu-img check -f qcow2 "$BUILD/disk.qcow2"
  sudo -n mv -n "$BUILD/disk.qcow2" "$GOLD"
  sudo -n chown root:root "$GOLD"
  sudo -n chmod 0444 "$GOLD"
  sudo -n sha256sum "$GOLD" | awk '{print "GOLD_SEALED_SHA256=" $1}'
  echo 'GOLD_IMAGE_READY_NO_SECRETS: next run script run; no CI runner registered in gold'
  exit 0
fi

[[ "$MODE" == run || "$MODE" == run-one ]] || fatal 'INTERNAL_UNKNOWN_MODE'
[[ -f "$GOLD" && ! -L "$GOLD" ]] || fatal 'GOLD_IMAGE_MISSING_OR_SYMLINK'
if [[ "$MODE" == run-one ]]; then
  RUN_LABELS="${RUN_LABELS:?}"
  case ",${RUN_LABELS}," in
    *,self-hosted,*|*,linux,*|*,x64,*|*,asi-vps-onecom,*) fatal 'COMMON_LABEL_BLOCK' ;;
  esac
  [[ "$RUN_LABELS" == "asi-${ADMITTED_RUN_ID}-${ADMITTED_ATTEMPT}-${ADMITTED_JOB_NAME}" ]] || fatal 'ROUTE_MISMATCH'
else
  RUN_LABELS='self-hosted,linux,x64,asi-vps-onecom'
fi
# One job per VM; overlays are discarded and the root-owned gold image is immutable.
for iteration in 1 2 3 4; do
  if [[ "$MODE" == run-one ]]; then
    [[ "$iteration" == 1 ]] || break
    run_id=$ADMITTED_RUN_ID
    python3 - "$REPO" "$run_id" "$ADMITTED_JOB_ID" "$ADMITTED_JOB_NAME" "$ROUTE_LABEL" <<'PY'
import json,subprocess,sys
repo,run_id,job_id,job_name,route=sys.argv[1:]
jobs=json.loads(subprocess.check_output(['gh','api',f'repos/{repo}/actions/runs/{run_id}/jobs?per_page=100'],timeout=30))
match=[j for j in jobs.get('jobs',[]) if str(j.get('id'))==job_id and j.get('status')=='queued' and j.get('name')==job_name and not j.get('conclusion')]
if len(match)!=1: raise SystemExit('BLOCKED: AUTHORIZED_JOB_NOT_QUEUED')
labels=[]
for label in match[0].get('labels') or []:
    labels.append(label.lower() if isinstance(label,str) else str(label.get('name','')).lower())
if set(labels)!={route} or {'self-hosted','linux','x64','asi-vps-onecom'} & set(labels):
    raise SystemExit('BLOCKED: ROUTE_MISMATCH')
PY
    echo "JOB_SLOT_1: queued=1 run=$run_id job=$ADMITTED_JOB_ID label=$RUN_LABELS"
  else
  [[ "$(gh api "repos/$REPO/pulls/$PR" --jq '.head.sha')" == "$HEAD" ]] || fatal 'PR head drift during orchestration'
  # Only register when the expected PR Validation job is actually waiting.
  run_id=$(gh api "repos/$REPO/actions/runs?head_sha=$HEAD&event=pull_request&per_page=100" \
    --jq '[.workflow_runs[] | select(.name == "PR Validation")] | sort_by(.id) | last | .id')
  [[ "$run_id" =~ ^[0-9]+$ ]] || fatal 'No PR Validation run for exact head'
  queued=$(gh api "repos/$REPO/actions/runs/$run_id/jobs?per_page=100" \
    --jq '[.jobs[] | select((.name == "source_validation" or .name == "channel-manager-recovery-postgres" or .name == "validate") and .status == "queued")] | length')
  if [[ "$queued" == 0 ]]; then echo 'NO_MORE_PR_VALIDATION_JOBS_QUEUED';break;fi
  echo "JOB_SLOT_${iteration}: queued=$queued run=$run_id"
  fi
  # API token is short-lived, scoped to registration; never printed.
  token=$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq '.token')
  [[ -n "$token" ]] || fatal 'GitHub runner registration token unavailable'
  TOKEN_PORT=$(python3 - <<'PY'
import socket
s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()
PY
)
  # Pipe the secret into one-use courier memory; no argv/env/ISO/disk copy.
  printf '%s\n' "$token" | sudo -n runuser -u "$RUNNER_USER" -- \
    python3 "$WORK/token_courier.py" "$TOKEN_PORT" >/dev/null 2>&1 & TOKEN_PID=$!
  unset token
  sleep 1
  kill -0 "$TOKEN_PID" 2>/dev/null || fatal 'One-use token courier failed to start'
  GUEST="$WORK/guest-$iteration"
  sudo -n install -d -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0700 "$GUEST"
  # Fast copy-on-write overlay; gold is root-owned immutable and contains NO keys/tokens.
  sudo -n runuser -u "$RUNNER_USER" -- qemu-img create -f qcow2 -F qcow2 \
    -b "$GOLD" "$GUEST/disk.qcow2" >/dev/null
  [[ "$(sudo -n qemu-img info -f qcow2 "$GUEST/disk.qcow2" | sed -n 's/^backing file format: //p')" == qcow2 ]] || fatal 'OVERLAY_BACKING_FORMAT_DRIFT'
  echo "GUEST_OVERLAY_CREATED: slot=$iteration"
  # Compose guest bootstrap with no host mounts, SSH or production secrets.
  local_tmp=$(mktemp -d /dev/shm/asi-landing-cloud.XXXXXXXX)
  chmod 0700 "$local_tmp"
  python3 - "$RUNNER_URL" "$RUNNER_SHA" "$iteration" "$PROXY_PORT" "$local_tmp" "$RUN_LABELS" "$MODE" "${ADMITTED_RUN_ID:-0}" "${ADMITTED_ATTEMPT:-0}" "${ADMITTED_JOB_NAME:-job}" "$HEAD" "${ADMITTED_JOB_ID:-0}" <<'PY'
import base64,pathlib,sys
URL,SHA,ITER,PORT,OUT,LABELS,MODE,RUN_ID,ATTEMPT,JOB_NAME,HEAD,JOB_ID=sys.argv[1:]; dst=pathlib.Path(OUT)
# The runner token is useful only for registration. No permanent GitHub credentials.
bootstrap=r'''#!/usr/bin/env bash
set -Eeuo pipefail
exec >>/var/log/asi-landing-guest.log 2>&1
PROXY=http://10.0.2.100:3128
export http_proxy="$PROXY" https_proxy="$PROXY" HTTP_PROXY="$PROXY" HTTPS_PROXY="$PROXY" no_proxy='localhost,127.0.0.1' NO_PROXY='localhost,127.0.0.1'
finish(){ rc=$?; echo "ASI_GUEST_EXIT_CODE=$rc" >/dev/ttyS0; sync; shutdown -P now || :; }
trap finish EXIT
printf 'ASI_EPHEMERAL_STAGE:BOOT\n' >/dev/ttyS0
# All software is preinstalled and verified in the immutable gold base.
for cmd in docker node npm git curl jq sha256sum; do command -v "$cmd" >/dev/null || exit 81; done
test -x /opt/actions-runner/config.sh || exit 82
test -x /opt/actions-runner/run.sh || exit 83
systemctl is-active --quiet docker || exit 84
id runner >/dev/null || exit 85
cd /opt/actions-runner
printf 'ASI_EPHEMERAL_STAGE:GOLD_TOOLS_READY\n' >/dev/ttyS0
# Mandatory network-deny tests: no direct egress, no host IP, no Cloud.ru via proxy.
if curl --noproxy '*' -fsS --connect-timeout 3 --max-time 5 https://api.github.com/ >/dev/null 2>&1; then exit 90; fi
if [[ -e /etc/asi/p1-686-owner-public.pem || -e /home/administrator/asi-continuous/queue.sqlite3 ]]; then exit 93; fi
if curl --noproxy '*' -fsS --connect-timeout 3 --max-time 5 http://10.0.2.2:22/ >/dev/null 2>&1; then exit 91; fi
if timeout 5 bash -c 'echo >/dev/tcp/81.88.19.230/22' >/dev/null 2>&1; then echo 'HOST_PUBLIC_IP_REACHABLE'; exit 91; fi
code=$(curl -sS -o /dev/null -w '%{http_connect}' --connect-timeout 3 --max-time 5 -x "$PROXY" https://api.cloud.ru/ || true)
[[ "$code" == 403 ]] || { echo "CLOUDRU_DENY_TEST_FAILED:$code";exit 92; }
# Configure Node's native fetch only for the exact governance CLI in this overlay.
if ! node -e 'if(typeof require("/usr/share/nodejs/undici").ProxyAgent!=="function") process.exit(1)' >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  timeout 180 apt-get -o Acquire::Retries=1 update
  timeout 180 apt-get -o Acquire::Retries=1 install -y --no-install-recommends node-undici
fi
install -d -o root -g root -m 0755 /usr/local/lib/asi-ci
cat >/usr/local/lib/asi-ci/github-fetch-proxy.cjs <<'ASIPROXY'
'use strict';
const path = require('node:path');
function configure() {
  const { ProxyAgent, setGlobalDispatcher } = require('/usr/share/nodejs/undici');
  const agent = new ProxyAgent('http://10.0.2.100:3128');
  setGlobalDispatcher(agent);
  return agent;
}
module.exports = configure;
if (process.argv[1] && path.resolve(process.argv[1]) ===
    '/opt/actions-runner/_work/asi-landing/asi-landing/scripts/agent-os/check-demo-release.mjs' &&
    process.argv.includes('--ci')) {
  configure();
  console.error('ASI_GOVERNANCE_FETCH_PROXY_ENABLED');
}
ASIPROXY
chmod 0644 /usr/local/lib/asi-ci/github-fetch-proxy.cjs
# Token-free connectivity check as the runner user, before registration.
timeout 30 runuser -u runner -- node -e '
const agent=require("/usr/local/lib/asi-ci/github-fetch-proxy.cjs")();
(async()=>{try {
  const r=await fetch("https://api.github.com/",{redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!r.ok) throw Error("HTTP_"+r.status);
  await r.arrayBuffer();
  console.log("NODE_FETCH_PROXY_PASS");
} finally { await agent.close(); }})().catch(e=>{console.error("NODE_FETCH_PROXY_FAIL",e.cause?.code||e.message);process.exitCode=1;});'
echo 'ASI_NODE_FETCH_PROXY_SMOKE_PASS' >/dev/ttyS0
# Runner binary is verified and cached in immutable gold; nothing downloaded here.
# Retrieve the registration token once, over a dedicated guestfwd channel.
# This endpoint disappears before the runner executes untrusted PR code.
REG_TOKEN=$(curl --noproxy '*' --fail --silent --show-error \
  --connect-timeout 8 --max-time 20 http://10.0.2.101:3129/registration)
[[ -n "$REG_TOKEN" ]] || { echo 'REGISTRATION_TOKEN_MISSING'; exit 96; }
RUNNER_ALLOW_RUNASROOT='' runuser -u runner -- env http_proxy="$PROXY" https_proxy="$PROXY" HTTP_PROXY="$PROXY" HTTPS_PROXY="$PROXY" ./config.sh --unattended --url https://github.com/ASI-integration/asi-landing --token "$REG_TOKEN" --name '__NAME__' __LABEL_ARGS__ --ephemeral --disableupdate --work _work
unset REG_TOKEN
# Never execute a second job. GitHub auto-deregisters ephemeral runners.
# Delete the bootstrap and cloud-init user-data (registration token) before PR code.
rm -f -- /usr/local/sbin/asi-landing-bootstrap
find /var/lib/cloud/instances -type f -name 'user-data.txt' -delete 2>/dev/null || :
# Defense in depth: detach even secret-free cloud-init seed CD before PR code.
lsblk -rno LABEL | grep -iq '^cidata$' || { echo 'SEED_LABEL_MISSING'; exit 94; }
echo 'ASI_EPHEMERAL_RUNNER_REGISTERED_WAIT_SEED_DETACH' >/dev/ttyS0
removed=NO
for attempt in $(seq 1 90); do
  if ! lsblk -rno LABEL | grep -iq '^cidata$'; then removed=YES; break; fi
  sleep 1
done
[[ "$removed" == YES ]] || { echo 'CLOUD_INIT_SEED_NOT_REMOVED'; exit 95; }
echo 'ASI_SEED_DEVICE_DETACHED_BEFORE_JOB' >/dev/ttyS0
__HOOK__
set +e
runner_env=(http_proxy="$PROXY" https_proxy="$PROXY" HTTP_PROXY="$PROXY" HTTPS_PROXY="$PROXY" NODE_OPTIONS=--require=/usr/local/lib/asi-ci/github-fetch-proxy.cjs)
if [[ -n "${ACTIONS_RUNNER_HOOK_JOB_STARTED:-}" ]]; then
  runner_env+=(ACTIONS_RUNNER_HOOK_JOB_STARTED="$ACTIONS_RUNNER_HOOK_JOB_STARTED")
fi
runuser -u runner -- env "${runner_env[@]}" ./run.sh
code=$?
set -e
echo "ASI_RUNNER_ONE_JOB_EXIT_CODE=$code" >/dev/ttyS0
exit "$code"
'''
hook=''
label_args='--labels '+LABELS
if MODE=='run-one':
    label_args='--no-default-labels --labels '+LABELS
    hook='''install -d -o root -g root -m 0755 /usr/local/lib/asi-ci /run/asi-ci
rm -f -- /run/asi-ci/assigned-job.fifo
mkfifo -m 0620 /run/asi-ci/assigned-job.fifo
chown root:runner /run/asi-ci/assigned-job.fifo
# Root copies one hook line to the host serial device, then removes the fifo.
(
  IFS= read -r line < /run/asi-ci/assigned-job.fifo || exit 0
  rm -f -- /run/asi-ci/assigned-job.fifo
  case "$line" in
    'ASI_ASSIGNED_JOB_MATCH user=runner uid='*)
      uid=${line#ASI_ASSIGNED_JOB_MATCH user=runner uid=}
      case "$uid" in
        ''|*[!0-9]*|0*) exit 0 ;;
      esac
      echo "$line" >/dev/ttyS0
      ;;
  esac
) &
cat > /usr/local/lib/asi-ci/verify-assigned-job.sh <<'HOOK'
#!/bin/bash
set -euo pipefail
[[ "$(id -u)" -ne 0 ]] || { echo HOOK_RAN_AS_ROOT; exit 97; }
if [[ "${ASI_HOOK_EXEC_CHECK:-}" == 1 ]]; then
  [[ -w /usr/local/lib/asi-ci/verify-assigned-job.sh ]] && { echo HOOK_WRITABLE_BY_RUNNER; exit 97; }
  echo "ASI_HOOK_EXEC_AS_RUNNER user=$(id -un) uid=$(id -u)"
  exit 0
fi
[[ "${GITHUB_RUN_ID:-}" == "%s" ]] || { echo ASSIGNED_JOB_MISMATCH; exit 97; }
[[ "${GITHUB_RUN_ATTEMPT:-}" == "%s" ]] || { echo ASSIGNED_JOB_MISMATCH; exit 97; }
[[ "${GITHUB_JOB:-}" == "%s" ]] || { echo ASSIGNED_JOB_MISMATCH; exit 97; }
if [[ "${GITHUB_EVENT_NAME:-}" == pull_request ]]; then
  [[ -n "${GITHUB_EVENT_PATH:-}" && -f "${GITHUB_EVENT_PATH}" ]] || { echo PR_EVENT_MISSING; exit 97; }
  pr_head=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(((d.get("pull_request") or {}).get("head") or {}).get("sha") or "")' "$GITHUB_EVENT_PATH")
  merge_sha=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print((d.get("pull_request") or {}).get("merge_commit_sha") or "")' "$GITHUB_EVENT_PATH")
  [[ "$pr_head" == "%s" ]] || { echo PR_HEAD_MISMATCH; exit 97; }
  [[ -n "$merge_sha" && "${GITHUB_SHA:-}" == "$merge_sha" ]] || { echo MERGE_SHA_MISMATCH; exit 97; }
  [[ "${GITHUB_SHA:-}" != "$pr_head" ]] || { echo MERGE_SHA_IS_PR_HEAD; exit 97; }
else
  [[ "${GITHUB_SHA:-}" == "%s" ]] || { echo HEAD_MISMATCH; exit 97; }
fi
echo "ASI_ASSIGNED_JOB_MATCH user=$(id -un) uid=$(id -u)" > /run/asi-ci/assigned-job.fifo
HOOK
chown root:root /usr/local/lib/asi-ci/verify-assigned-job.sh
chmod 0755 /usr/local/lib/asi-ci/verify-assigned-job.sh
runuser -u runner -- env ASI_HOOK_EXEC_CHECK=1 /usr/local/lib/asi-ci/verify-assigned-job.sh >/dev/ttyS0
export ACTIONS_RUNNER_HOOK_JOB_STARTED=/usr/local/lib/asi-ci/verify-assigned-job.sh
''' % (RUN_ID, ATTEMPT, JOB_NAME, HEAD, HEAD)
    name='asi-%s-%s-%s' % (RUN_ID, ATTEMPT, JOB_ID)
else:
    name='asi-landing-kvm-687-'+ITER
bootstrap=bootstrap.replace('__ITER__',ITER).replace('__LABEL_ARGS__',label_args).replace('__NAME__',name).replace('__HOOK__',hook)
if MODE=='run-one':
    assert 'linux,x64,asi-vps-onecom' not in bootstrap
    assert '--no-default-labels --labels '+LABELS in bootstrap
    assert 'self-hosted' not in label_args
    assert 'chmod 0755 /usr/local/lib/asi-ci/verify-assigned-job.sh' in bootstrap
    assert 'merge_commit_sha' in bootstrap
    assert 'assigned-job.fifo' in bootstrap
    assert 'ACTIONS_RUNNER_HOOK_JOB_STARTED="$ACTIONS_RUNNER_HOOK_JOB_STARTED"' in bootstrap
    assert 'dialout' not in bootstrap
    hook_script=bootstrap.split("<<'HOOK'\n",1)[1].split('\nHOOK\n',1)[0]
    assert '>/dev/ttyS0' not in hook_script
    assert LABELS=='asi-%s-%s-%s' % (RUN_ID, ATTEMPT, JOB_NAME)
assert '__TOKEN__' not in bootstrap
assert '__LABEL_ARGS__' not in bootstrap and '__HOOK__' not in bootstrap
userdata='#cloud-config\nssh_pwauth: false\ndisable_root: true\nusers: [default]\nwrite_files:\n  - path: /usr/local/sbin/asi-landing-bootstrap\n    owner: root:root\n    permissions: "0700"\n    encoding: b64\n    content: '+base64.b64encode(bootstrap.encode()).decode()+'\nruncmd:\n  - [bash, /usr/local/sbin/asi-landing-bootstrap]\n'
(dst/'user-data').write_text(userdata)
(dst/'meta-data').write_text('instance-id: asi-landing-687-'+ITER+'\nlocal-hostname: asi-landing-ephem\n')
PY
  sudo -n cloud-localds "$GUEST/seed.iso" "$local_tmp/user-data" "$local_tmp/meta-data"
  rm -rf -- "$local_tmp"
  sudo -n chown "$RUNNER_USER:$RUNNER_USER" "$GUEST/seed.iso"
  sudo -n chmod 0600 "$GUEST/seed.iso"
  # QEMU restrict=on blocks all host/external traffic except explicit guestfwd
  # to the allowlisted localhost proxy. No shared filesystem or host ports.
  sudo -n runuser -u "$RUNNER_USER" -- timeout --signal=TERM --kill-after=30s 3300 \
    qemu-system-x86_64 -machine q35,accel=kvm -cpu host -smp 4 -m 6144 \
      -nodefaults -display none -no-reboot \
      -drive "if=virtio,format=qcow2,file=$GUEST/disk.qcow2" \
      -drive "if=none,id=seed,media=cdrom,format=raw,readonly=on,file=$GUEST/seed.iso" \
      -device virtio-scsi-pci,id=scsi0 -device scsi-cd,id=ci-seed,drive=seed,bus=scsi0.0 \
      -netdev "user,id=net0,ipv6=off,restrict=on,guestfwd=tcp:10.0.2.100:3128-cmd:/usr/bin/nc.openbsd -N 127.0.0.1 $PROXY_PORT,guestfwd=tcp:10.0.2.101:3129-cmd:/usr/bin/nc.openbsd -N 127.0.0.1 $TOKEN_PORT" \
      -device virtio-net-pci,netdev=net0 \
      -serial "file:$GUEST/console.log" \
      -qmp "unix:$GUEST/qmp.sock,server=on,wait=off" \
      -monitor none &
  QEMU_PID=$!
  detached=NO
  # Host-only QMP detaches cloud-init ISO before the runner accepts a job.
  while kill -0 "$QEMU_PID" 2>/dev/null; do
    if [[ "$detached" == NO ]] && sudo -n grep -q \
      'ASI_EPHEMERAL_RUNNER_REGISTERED_WAIT_SEED_DETACH' "$GUEST/console.log" 2>/dev/null; then
      # One-use courier must have exited before any untrusted job starts.
      if [[ -n "$TOKEN_PID" ]]; then
        wait "$TOKEN_PID" || fatal 'One-use token courier failed before seed detachment'
        TOKEN_PID=''
      fi
      sudo -n python3 - "$GUEST/qmp.sock" <<'QMP'
import json,socket,sys,time
path=sys.argv[1]
sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
sock.settimeout(10)
sock.connect(path)
def read_until(predicate):
    end=time.monotonic()+10
    pending=b''
    while time.monotonic()<end:
        pending+=sock.recv(8192)
        while b'\n' in pending:
            raw,pending=pending.split(b'\n',1)
            if not raw.strip():continue
            entry=json.loads(raw)
            if predicate(entry):return entry
    raise RuntimeError('QMP_TIMEOUT')
read_until(lambda x:'QMP' in x)
sock.sendall(b'{"execute":"qmp_capabilities"}\n')
assert 'return' in read_until(lambda x:'return' in x or 'error' in x)
sock.sendall(b'{"execute":"device_del","arguments":{"id":"ci-seed"}}\n')
assert 'return' in read_until(lambda x:'return' in x or 'error' in x)
print('QMP_SEED_DEVICE_DEL_REQUESTED')
sock.close()
QMP
      detached=YES
      echo 'HOST_QMP_SEED_DEVICE_DEL_REQUESTED'
    fi
    sleep 3
  done
  set +e
  wait "$QEMU_PID"; vmrc=$?
  set -e
  QEMU_PID=''
TOKEN_PID=''
  echo "GUEST_$iteration QEMU_RC=$vmrc"
  [[ "$detached" == YES ]] || fatal "Host never detached credential seed ISO"
  sudo -n grep -E 'ASI_(GUEST_EXIT_CODE|RUNNER_ONE_JOB_EXIT_CODE|SEED_DEVICE_DETACHED|EPHEMERAL_RUNNER_REGISTERED)' "$GUEST/console.log" || true
  # Remove guest disk & registration token seed, ALWAYS before the next VM.
  sudo -n rm -f -- "$GUEST/disk.qcow2" "$GUEST/seed.iso"
  [[ "$vmrc" == 0 ]] || fatal "VM $iteration failed; check $GUEST/console.log before repeating; no blind replay"
  sudo -n grep -q 'ASI_SEED_DEVICE_DETACHED_BEFORE_JOB' "$GUEST/console.log" || fatal 'Guest seed was not detached before job'
  if [[ "$MODE" == run-one ]]; then
    sudo -n grep -q 'ASI_HOOK_EXEC_AS_RUNNER user=runner' "$GUEST/console.log" || fatal 'Job hook was not executed by the runner user'
    sudo -n grep -q 'ASI_ASSIGNED_JOB_MATCH user=runner' "$GUEST/console.log" || fatal 'Assigned job was not confirmed by the runner user'
  fi
  sudo -n grep -q 'ASI_RUNNER_ONE_JOB_EXIT_CODE=0' "$GUEST/console.log" || fatal 'Guest did not attest successful ephemeral runner exit'
  sleep 8
  # Fail closed if any job failed; no automatically repeated CI effects.
  gh api "repos/$REPO/actions/runs/$run_id/jobs?per_page=100" --jq '.jobs[] | select(.conclusion == "failure") | .name' | grep -q . && fatal 'PR Validation job failed; inspect GitHub before retry' || true
done

# Validate exact run jobs. This does not make release_governance pass.
run_id=$(gh api "repos/$REPO/actions/runs?head_sha=$HEAD&event=pull_request&per_page=100" \
 --jq '[.workflow_runs[] | select(.name == "PR Validation")] | sort_by(.id) | last | .id')
gh api "repos/$REPO/actions/runs/$run_id/jobs?per_page=100" \
 --jq '.jobs[] | {name,status,conclusion,runner_name}'
echo "SELFHOSTED_EPHEMERAL_GUESTS_PROCESSED; release_governance remains separate owner-gated CI"
echo "ZERO_CLOUDRU_EFFECTS_FROM_HOST_SCRIPT; ISSUE_686_HOLD; ASI_PAID_CALLS_ENABLED=NO"
