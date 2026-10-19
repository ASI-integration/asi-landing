"""Runner-only encrypted receipt storage; offline decryption never logs plaintext."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile

import c4_unit_contract as c

RECIPIENT = "6afa982f3e0737e1567e13bfdb858d9eef00ede86b481a69d758a7f3e107a733"
CERT = Path(__file__).resolve().parent / "backup-recipient.crt"
NAME = "unit-receipt.cms"
MAX_CIPHER = 16384


def command(args, raw=None):
    # No inherited OpenSSL configuration, credentials, debug flags or raw errors.
    """Run bounded OpenSSL with a minimal environment and suppress raw failures."""
    try:
        executable = shutil.which("openssl")
        c.require(executable is not None, "CRYPTO")
        clean = {"PATH": os.defpath, "LC_ALL": "C"}
        # Windows OpenSSL needs SystemRoot to obtain OS entropy. No user
        # OpenSSL configuration or credentials are inherited.
        if os.name == "nt":
            system_root = os.environ.get("SYSTEMROOT", "")
            c.require(bool(system_root), "CRYPTO")
            clean["SYSTEMROOT"] = system_root
        result = subprocess.run([executable, *args], input=raw, capture_output=True,
                                timeout=15, env=clean)
        c.require(result.returncode == 0, "CRYPTO")
        return result.stdout
    except (OSError, subprocess.TimeoutExpired):
        raise c.Block("CRYPTO") from None


def regular(path, limit):
    """Read one bounded regular file, rejecting links and observed identity changes."""
    path = Path(path)
    c.require(path.absolute() == path.resolve(), "PATH")
    named_before = path.lstat()
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_BINARY", 0)
                 | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    try:
        before = os.fstat(fd)
        c.require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                  and 0 < before.st_size <= limit, "FILE")
        raw = os.read(fd, before.st_size + 1)
        named_after = path.lstat()
        # Windows 3.14 reports different ctime values through fstat/lstat.
        # Compare each API's full signature before/after, and retain cross-API
        # inode/device/mode/link/size/mtime identity. Linux also compares ctime.
        fd_signature, path_signature = c.signature(before), c.signature(named_after)
        same_identity = (fd_signature[:-1] == path_signature[:-1] if os.name == "nt"
                         else fd_signature == path_signature)
        c.require(len(raw) == before.st_size and same_identity
                  and fd_signature == c.signature(os.fstat(fd))
                  and c.signature(named_before) == path_signature, "READ_RACE")
        return raw
    finally:
        os.close(fd)


def recipient(raw, expected=RECIPIENT):
    """Require the pinned public certificate and at least one remaining validity day."""
    c.require(type(raw) is bytes and 0 < len(raw) <= 8192, "CERTIFICATE")
    der = command(["x509", "-outform", "DER"], raw)
    c.require(hashlib.sha256(der).hexdigest() == expected, "RECIPIENT")
    command(["x509", "-checkend", "86400", "-noout"], raw)
    return raw


def encrypt(raw, cert):
    """Encrypt in-memory receipt bytes using authenticated CMS for this certificate."""
    c.require(type(raw) is bytes and 0 < len(raw) <= 4096, "SIZE")
    # Temporary file contains ONLY the pinned public certificate. Receipt stays
    # in pipes/memory; private recipient key is never available to this runner.
    with tempfile.TemporaryDirectory(prefix="c4-public-recipient-") as folder:
        path = Path(folder) / "recipient.crt"
        path.write_bytes(cert)
        cipher = command(["cms", "-encrypt", "-binary", "-aes-256-gcm", "-outform", "DER",
                          "-recip", str(path), "-keyopt", "rsa_padding_mode:oaep",
                          "-keyopt", "rsa_oaep_md:sha256", "-keyopt", "rsa_mgf1_md:sha256"], raw)
    c.require(512 <= len(cipher) <= MAX_CIPHER, "CIPHERTEXT")
    return cipher


def canonical(value, sha, rid):
    """Validate the exact receipt binding and serialize its closed schema deterministically."""
    c.validate_receipt(value, sha, rid)
    # This recovery is bound to the observed 454-byte source and one-byte plan.
    c.require(value["unitBytes"] == 454 and value["removedBytes"] == 1
              and value["planState"] == "REMOVE_ONE_OPTIONAL_BYTE", "PLAN")
    raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii")
    c.require(len(raw) <= 4096, "SIZE")
    return raw


def output_dir(env):
    """Derive the attempt-one ciphertext directory beneath the real runner temp root."""
    rid = env.get("GITHUB_RUN_ID", "")
    c.require(c.RUN.fullmatch(rid) and env.get("GITHUB_RUN_ATTEMPT") == "1", "RUN")
    root = Path(env.get("RUNNER_TEMP", ""))
    c.require(root.is_absolute() and root == root.resolve() and root.is_dir(), "PATH")
    return root / ("c4-unit-receipt-" + rid + "-1")


def prepare(env):
    """Verify recipient and crypto support before creating a fresh output directory."""
    cert = recipient(regular(CERT, 8192))
    encrypt(b'{"preflight":"synthetic-no-server-data"}', cert)
    folder = output_dir(env)
    folder.mkdir(mode=0o700)  # Refuse pre-existing files, directories and symlinks.
    return cert, folder


def write_new(path, raw):
    """Create and durably write a private binary file without replacing existing paths."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
                 | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        view = memoryview(raw)
        while view:
            count = os.write(fd, view)
            c.require(count > 0, "WRITE")
            view = view[count:]
        os.fsync(fd)
    finally:
        os.close(fd)
    if hasattr(os, "O_DIRECTORY"):
        fd = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def save(value, sha, rid, cert, folder):
    """Durably save validated ciphertext and return its in-memory digest for readback."""
    cipher = encrypt(canonical(value, sha, rid), cert)
    path = folder / NAME
    write_new(path, cipher)
    # Upload must precede readback: a late local read failure must not discard
    # the one permitted observation. The final check uses this in-memory pin.
    return c.digest(cipher)


def verify_download(env):
    """Require both ciphertext copies to match the original in-memory encryption digest."""
    expected = env.get("C4_RECEIPT_CIPHER_SHA256", "")
    c.require(type(expected) is str and c.HEX.fullmatch(expected), "CIPHERTEXT_DIGEST")
    original = output_dir(env)
    downloaded = original.with_name(original.name + "-download")
    for folder in (original, downloaded):
        c.require(folder == folder.resolve() and folder.is_dir()
                  and {x.name for x in folder.iterdir()} == {NAME}, "ARTIFACT_FILES")
    before = regular(original / NAME, MAX_CIPHER)
    after = regular(downloaded / NAME, MAX_CIPHER)
    c.require(before == after and c.digest(before) == expected, "READBACK")


def open_offline(cipher_path, key_path, cert_path, sha, rid, output):
    """Decrypt outside Actions after caller-verified provenance and save a bound receipt."""
    c.require(os.environ.get("GITHUB_ACTIONS") != "true", "OFFLINE_ONLY")
    recipient(regular(cert_path, 8192))
    # Caller first verifies API artifact provenance/digest as documented. CMS
    # authenticates encrypted content, not the sender (public key is public).
    raw = command(["cms", "-decrypt", "-binary", "-inform", "DER", "-recip", str(cert_path),
                   "-inkey", str(key_path)], regular(cipher_path, MAX_CIPHER))
    c.require(0 < len(raw) <= 4096, "SIZE")
    value = c.strict_json(raw)
    verified = canonical(value, sha, rid)
    c.require(raw == verified, "CANONICAL")
    write_new(output, verified + b"\n")
    c.require(regular(output, 4096) == verified + b"\n", "READBACK")


def main():
    """Dispatch local receipt operations while emitting only fixed non-sensitive statuses."""
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="operation", required=True)
    sub.add_parser("verify-download")
    local = sub.add_parser("open-offline")
    for name in ("cipher", "key", "cert", "sha", "run", "output"):
        local.add_argument("--" + name, required=True)
    args = parser.parse_args()
    try:
        if args.operation == "verify-download":
            verify_download(os.environ)
        else:
            open_offline(args.cipher, args.key, args.cert, args.sha, args.run, args.output)
        print('{"status":"C4_RECEIPT_VERIFIED"}')
        return 0
    except BaseException:
        print('{"status":"C4_RECEIPT_BLOCK"}')
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
