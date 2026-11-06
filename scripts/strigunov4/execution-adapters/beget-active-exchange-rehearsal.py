"""Physically exercise atomic directory exchange ONLY inside a disposable scratch.
NOT an installed Engine updater. No live /opt, /etc, /var/lib/asi-engine,
systemctl, sudo, keys, secrets or remote API use. No --apply option exists.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import stat

class Block(Exception):
    pass

def require(value, reason):
    if not value:
        raise Block(reason)

def digest(blob):
    return hashlib.sha256(blob).hexdigest()

ALLOWED_ROOTS = (Path('/tmp'), Path('/var/lib/asi-dc/tasks'))
def verify_scratch(root):
    require(isinstance(root, Path) and root.is_absolute(), 'REHEARSAL_ROOT_INVALID')
    require(root.resolve() == root and root.name.startswith('asi-upgrade-rehearsal-'),
            'REHEARSAL_PATH_FORBIDDEN')
    require(root.parent in ALLOWED_ROOTS, 'REHEARSAL_PARENT_FORBIDDEN')
    st = root.lstat()
    require(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode)
            and st.st_uid == os.getuid() and st.st_mode & 0o077 == 0,
            'REHEARSAL_ROOT_UNSAFE')

def regular_bytes(file):
    st=file.lstat()
    require(stat.S_ISREG(st.st_mode) and not stat.S_ISLNK(st.st_mode)
            and st.st_nlink == 1 and st.st_uid == os.getuid() and st.st_size < 500000,
            'REHEARSAL_FILE_UNSAFE')
    with file.open('rb') as f:
        value=f.read(500001)
    require(len(value) == st.st_size, 'REHEARSAL_FILE_CHANGED')
    return value

def manifest(directory):
    st=directory.lstat()
    require(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode)
            and st.st_uid == os.getuid() and st.st_mode & 0o077 == 0,
            'REHEARSAL_GENERATION_UNSAFE')
    names={p.name for p in directory.iterdir()}
    require(names == {'manifest.json','module.mjs'}, 'REHEARSAL_GENERATION_EXTRA_FILES')
    raw=regular_bytes(directory/'manifest.json')
    m=json.loads(raw)
    module=regular_bytes(directory/'module.mjs')
    require(m.keys() == {'sha256','generation'} and
            isinstance(m['generation'],str) and
            len(m['generation']) <= 80 and
            m['sha256'] == digest(module), 'REHEARSAL_MANIFEST_MISMATCH')
    return {'generation':m['generation'],'moduleSha256':digest(module),
            'manifestSha256':digest(raw)}

def exchange(a,b):
    libc=ctypes.CDLL(None,use_errno=True)
    require(hasattr(libc,'renameat2'), 'ATOMIC_EXCHANGE_UNAVAILABLE')
    fn=libc.renameat2
    fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
    fn.restype=ctypes.c_int
    # AT_FDCWD=-100, RENAME_EXCHANGE=2. Both directories already exist on
    # the same filesystem; no intermediate missing live pathname.
    rc=fn(-100,os.fsencode(a),-100,os.fsencode(b),2)
    if rc:
        raise Block('ATOMIC_EXCHANGE_FAILED_'+str(ctypes.get_errno()))

def fsync_dir(p):
    fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def rehearse(root, *, dry_run=False):
    verify_scratch(root)
    live=root/'generation-active'
    candidate=root/'generation-next'
    state=root/'private-state'
    state_st=state.lstat()
    require(stat.S_ISDIR(state_st.st_mode) and not stat.S_ISLNK(state_st.st_mode)
            and state_st.st_uid==os.getuid() and state_st.st_mode & 0o077==0,
            'REHEARSAL_STATE_UNSAFE')
    state_bytes=regular_bytes(state/'ledger.json')
    old=manifest(live)
    proposed=manifest(candidate)
    require(old['generation'] != proposed['generation'] and old['moduleSha256'] !=
            proposed['moduleSha256'],'REHEARSAL_GENERATIONS_IDENTICAL')
    output={'schema':'asi.beget-upgrade-exchange-rehearsal.v1',
       'authorized':False,'installable':False,'liveServiceTouched':False,
       'old':old,'proposed':proposed,'stateSha256':digest(state_bytes),
       'atomicExchangeDemonstrated':False}
    if dry_run:
        return output
    # No writes to private-state at any stage. The old generation survives
    # at generation-next. Unknown exchange/durability result is never retried.
    exchange(live,candidate)
    fsync_dir(root)
    installed=manifest(live)
    preserved=manifest(candidate)
    require(installed == proposed and preserved == old and
            regular_bytes(state/'ledger.json') == state_bytes,
            'REHEARSAL_POST_EXCHANGE_INTEGRITY_UNKNOWN')
    output['atomicExchangeDemonstrated']=True
    output['oldGenerationPreserved']=True
    return output

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--rehearse-root',type=Path,required=True)
    parser.add_argument('--dry-run',action='store_true')
    opts=parser.parse_args()
    try:
        print(json.dumps(rehearse(opts.rehearse_root,dry_run=opts.dry_run)))
    except (Block, OSError, ValueError, KeyError):
        print(json.dumps({'status':'BLOCKED','authorized':False,
              'installable':False,'liveServiceTouched':False}))
        raise SystemExit(1)

if __name__ == '__main__':
    main()
