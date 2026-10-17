"""Offline G0 release archive contract; no extraction or filesystem mutation.

Used by a future separately owner-reviewed, staging-only systemd installer.
This verifier is never itself deployment authorization.
"""
import hashlib
import json
import posixpath
from pathlib import Path
import tarfile

SHA="d912aec6663de90e5ca4293cc5a69e2e0ed9ff94"
TREE="0247b7a5a71b89b8d2c034e6d69340e14dae9ac8"
SOURCE_G0="334d93fc39d2ea51ba283dd0314bbc239ff49707"
ARCHIVE_HASH="030880c750c8fb28cb61ebfbba85e0e23718279e4c165655fcae6a1c2d07c486"
ARCHIVE_BYTES=229060580
LOCK_HASH="9fb7cfba1ec8b0c0151a81a3447555c94130e65e732fdda8f1659785603018ae"
NEEDED=frozenset(("release-meta.json",".next/BUILD_ID",
                  "node_modules/next/dist/bin/next","package.json","package-lock.json"))
MAX_MEMBERS=120000
MAX_TOTAL=4*1024**3
MAX_SINGLE=2*1024**3


class Block(ValueError):
    pass


def require(ok,code):
    if not ok:
        raise Block(code)


def file_digest(file):
    h=hashlib.sha256()
    with Path(file).open("rb") as stream:
        for chunk in iter(lambda:stream.read(1048576),b""):
            h.update(chunk)
    return h.hexdigest()


def clean_member(member):
    """Reject tar paths that could be used to write outside a new release."""
    name=member.name
    require(type(name) is str and 0<len(name)<=2048
            and not name.startswith("/") and "\\" not in name
            and "\0" not in name,"TAR_PATH")
    base=name.rstrip("/") if member.isdir() else name
    require(base not in ("","",".","..")
            and posixpath.normpath(base)==base
            and not any(c in (".","..") for c in base.split("/")),
            "TAR_PATH_NORMALIZATION")
    if member.issym():
        link=member.linkname
        require(type(link) is str and 0<len(link)<=2048
                and not posixpath.isabs(link) and "\\" not in link
                and "\0" not in link,"TAR_SYMLINK_IDENTITY")
        where=posixpath.normpath(posixpath.join(posixpath.dirname(base),link))
        require(where not in (".","..") and not where.startswith("../"),
                "TAR_SYMLINK_ESCAPE")
    require(member.isreg() or member.isdir() or member.issym(),"TAR_UNSUPPORTED_TYPE")
    require(member.size>=0 and member.size<=MAX_SINGLE,"TAR_MEMBER_SIZE")
    return base


def inspect(archive, *, expected_sha=ARCHIVE_HASH,expected_size=ARCHIVE_BYTES,
            expected_git=SHA,expected_tree=TREE,expected_lock=LOCK_HASH):
    path=Path(archive)
    require(path.is_file() and not path.is_symlink()
            and path.stat().st_size==expected_size,"ARCHIVE_FILE")
    require(file_digest(path)==expected_sha,"ARCHIVE_DIGEST")
    visited=set()
    counters={"files":0,"dirs":0,"symlinks":0}
    regular_bytes=0
    verified_meta=False
    verified_lock=False
    with tarfile.open(path,"r:gz") as stream:
        for member in stream:
            name=clean_member(member)
            require(name not in visited,"TAR_DUPLICATE_PATH")
            visited.add(name)
            require(len(visited)<=MAX_MEMBERS,"TAR_MEMBER_COUNT")
            if member.isreg():
                counters["files"]+=1
                regular_bytes+=member.size
                require(regular_bytes<=MAX_TOTAL,"TAR_EXPANDED_SIZE")
            elif member.isdir():
                counters["dirs"]+=1
            else:
                counters["symlinks"]+=1
            if name=="release-meta.json":
                require(member.isreg() and 0<member.size<=16384,"RELEASE_META_SIZE")
                record=json.load(stream.extractfile(member))
                require(type(record) is dict
                        and record.get("gitSha")==expected_git
                        and record.get("sourceTreeSha")==expected_tree
                        and record.get("g0SourceSha")==SOURCE_G0
                        and record.get("environment")=="staging",
                        "RELEASE_METADATA_IDENTITY")
                verified_meta=True
            if name=="package-lock.json":
                require(member.isreg() and 0<member.size<=32*1024*1024,
                        "SOURCE_LOCK_SIZE")
                h=hashlib.sha256()
                with stream.extractfile(member) as content:
                    for chunk in iter(lambda:content.read(1048576),b""):
                        h.update(chunk)
                require(h.hexdigest()==expected_lock,"SOURCE_LOCK_DIGEST")
                verified_lock=True
    require(NEEDED <= visited and verified_meta and verified_lock,
            "RELEASE_REQUIRED_FILES")
    return {"status":"G0_TAR_CONTRACT_PASS","archiveSha256":expected_sha,
            "releaseSha":expected_git,"files":counters["files"],
            "dirs":counters["dirs"],"symlinks":counters["symlinks"],
            "expandedBytes":regular_bytes,"sourceLockVerified":True,
            "extractionPerformed":False,"activationPerformed":False}


def main():
    import argparse
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--archive",type=Path,required=True)
    args=p.parse_args()
    try:
        print(json.dumps(inspect(args.archive),sort_keys=True))
        return 0
    except (OSError,Block,ValueError,tarfile.TarError):
        print('{"status":"BLOCK","extractionPerformed":false,"activationPerformed":false}')
        return 2


if __name__=="__main__":
    raise SystemExit(main())
