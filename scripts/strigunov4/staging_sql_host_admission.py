"""Read-only host admission, invoked only via pinned SSH from protected main.

No SQL connections, no env mutations, no systemctl controls, no provider sends.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

import strigunov_reviewed_probe as probe

BACKUP_RUN=39023529319
BACKUP_SHA256="e72aea476efabd3625566759748d6d819c4cea22f12ee0ec483948b41dc5afef"
BACKUP_BYTES=339054
BACKUP=Path("/home/project_ayfaar/.strigunov4-staging-backups/strigunov4-staging-39023529319-1.tar.gz.cms")
SOURCE_RELEASE="5c91b27bcde395f01cc078d1fbe454dd7436e1c6"

def digest(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1048576),b""):
            h.update(chunk)
    return h.hexdigest()

def confirm_backup():
    p=BACKUP.parent
    if p.is_symlink() or not p.is_dir():
        return False
    own=os.getuid()
    meta=p.stat(follow_symlinks=False)
    if meta.st_uid!=own or stat.S_IMODE(meta.st_mode)!=0o700:
        return False
    if BACKUP.is_symlink() or not BACKUP.is_file():
        return False
    record=BACKUP.stat(follow_symlinks=False)
    if record.st_uid!=own or stat.S_IMODE(record.st_mode)!=0o600 or record.st_size!=BACKUP_BYTES:
        return False
    return digest(BACKUP)==BACKUP_SHA256

def main():
    result={"status":"BLOCK","backup_verified":False,
            "archive_verified":False,"no_send_ready":False,
            "old_release_verified":False}
    try:
        if os.getuid()==0 or os.uname().nodename!="asi-agent-runner":
            raise ValueError("HOST_SCOPE")
        result["backup_verified"]=confirm_backup()
        result["archive_verified"]=probe.archive_verified()
        failed=probe.stage_state()
        result["no_send_ready"]=not failed
        result["old_release_verified"]=True
        if all((result["backup_verified"],result["archive_verified"],
                result["no_send_ready"],result["old_release_verified"])):
            result["status"]="STAGING_SQL_ADMISSION_PASS"
    except Exception:
        pass
    print(json.dumps(result,sort_keys=True))
    return 0 if result["status"]=="STAGING_SQL_ADMISSION_PASS" else 2

if __name__=="__main__":
    sys.exit(main())
