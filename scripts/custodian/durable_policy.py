"""Durable synthetic policy boundary. No live authority or external actions.

The signing key is never stored here. Production enrollment is unavailable.
Same-owner/root restoration of the entire store cannot be detected locally.
"""
from __future__ import annotations
import contextlib
import fcntl
import functools
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import struct
import subprocess
import tempfile
import time

SCOPE = 'ASI_DURABLE_SYNTHETIC_V1'
MAX_BYTES = 1024 * 1024
HEX = re.compile(r'^[0-9a-f]{64}$')
FLAGS = dict(authorized=False, canInstall=False, canApprove=False, canSend=False,
             canIssueReceipt=False, phase2='BLOCK', ownerAuthority='UNAVAILABLE')

class Hold(Exception):
    pass

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()

def digest(value):
    return hashlib.sha256(value).hexdigest()

def decode(raw, limit):
    if not isinstance(raw, bytes) or len(raw) > limit:
        raise Hold('INPUT_SIZE')
    try:
        value = json.loads(raw)
        if canonical(value) != raw or not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, TypeError, UnicodeError):
        raise Hold('CANONICAL_OBJECT_REQUIRED') from None

def integer(value, minimum=1):
    return type(value) is int and minimum <= value <= 2**53 - 1

def private(path, directory=False):
    path = Path(path).absolute()
    info = path.lstat()
    if (path.resolve() != path or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != (0o700 if directory else 0o600)
            or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            or (not directory and info.st_nlink != 1)):
        raise Hold('PRIVATE_OWNED_PATH_REQUIRED')
    return info

def read(path, limit=MAX_BYTES):
    before = private(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        current = os.fstat(fd)
        if (current.st_dev, current.st_ino) != (before.st_dev, before.st_ino) or current.st_size > limit:
            raise Hold('INPUT_REPLACED_OR_OVERSIZE')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read(limit + 1)
        if len(data) > limit:
            raise Hold('INPUT_SIZE')
        return data
    finally:
        os.close(fd)

def new_file(path, blob):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        if os.write(fd, blob) != len(blob):
            raise Hold('SHORT_WRITE')
        os.fsync(fd)
    finally:
        os.close(fd)

def sync_dir(root):
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def fail_closed(method):
    @functools.wraps(method)
    def guarded(*args, **kwargs):
        try:
            return method(*args, **kwargs)
        except (OSError, ValueError, TypeError, KeyError, struct.error, subprocess.SubprocessError):
            raise Hold('UNAVAILABLE_OR_CORRUPT') from None
    return guarded

class Boundary:
    """Local controller owns publication; accepted socket supplies peer identity.

    Constructor pins are provisioning configuration, never IPC request fields.
    Only synthetic signed policies/receipts are accepted. No issuer API exists.
    """
    def __init__(self, root, public_key: bytes, *, issuer, key_id, key_sha256,
                 host, archive_sha256, enabled=False):
        self.root = Path(root).absolute()
        self.enabled = enabled
        if os.getuid() == 0 or not hasattr(socket, 'SO_PEERCRED'):
            raise Hold('LINUX_NONROOT_REQUIRED')
        self.identity = private(self.root, directory=True)
        for parent in self.root.parents:
            info = parent.lstat()
            sticky_root = info.st_uid == 0 and bool(info.st_mode & stat.S_ISVTX)
            if info.st_uid not in (0, os.getuid()) or (info.st_mode & 0o022 and not sticky_root):
                raise Hold('UNTRUSTED_STATE_ANCESTRY')
        if (not isinstance(public_key, bytes) or len(public_key) > 4096
                or digest(public_key) != key_sha256 or not HEX.fullmatch(archive_sha256)
                or any(not isinstance(x, str) or not 1 <= len(x) <= 128 for x in (issuer, key_id, host))):
            raise Hold('TRUST_PINS')
        self.key = public_key
        self.pins = dict(scope=SCOPE, issuer=issuer, keyId=key_id, keySha256=key_sha256,
                         host=host, archiveSha256=archive_sha256, liveAuthority=False)
        self.binding = digest(canonical(self.pins))

    @fail_closed
    def initialize(self):
        if not self.enabled:
            raise Hold('DEFAULT_OFF')
        # Explicit provisioning only. An operational missing file never initializes.
        if list(self.root.iterdir()):
            raise Hold('INITIALIZATION_REQUIRES_EMPTY_DIRECTORY')
        new_file(self.root/'lock', b'')
        state = dict(binding=self.binding, epoch=0, policy=None, policyDigest=None,
                     revoked=[], events=[], lastTime=int(time.time()))
        new_file(self.root/'pending', b'initialization')
        sync_dir(self.root)
        blob = canonical(state)
        new_file(self.root/'state', blob)
        new_file(self.root/'checkpoint', digest(blob).encode())
        sync_dir(self.root)
        (self.root/'pending').unlink()
        sync_dir(self.root)

    @contextlib.contextmanager
    def locked(self):
        if not self.enabled:
            raise Hold('DEFAULT_OFF')
        info = private(self.root, directory=True)
        if (info.st_dev, info.st_ino) != (self.identity.st_dev, self.identity.st_ino):
            raise Hold('DIRECTORY_REPLACED')
        lock = self.root/'lock'
        before = private(lock)
        fd = os.open(lock, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            current = os.fstat(fd)
            after = private(lock)
            if (before.st_dev, before.st_ino) != (current.st_dev, current.st_ino) or (after.st_dev, after.st_ino) != (current.st_dev, current.st_ino):
                raise Hold('LOCK_REPLACED')
            if (self.root/'pending').exists() or (self.root/'pending').is_symlink():
                raise Hold('UNRESOLVED_INTENT')
            yield fd
        except BlockingIOError:
            raise Hold('BUSY_RETRY') from None
        finally:
            os.close(fd)

    def load(self):
        blob = read(self.root/'state')
        if read(self.root/'checkpoint', 64) != digest(blob).encode():
            raise Hold('CHECKPOINT_MISMATCH')
        state = decode(blob, MAX_BYTES)
        if (set(state) != {'binding','epoch','policy','policyDigest','revoked','events','lastTime'}
                or state['binding'] != self.binding or not integer(state['epoch'], 0)
                or not integer(state['lastTime'], 0) or not isinstance(state['events'], list)
                or len(state['events']) > 1000 or not isinstance(state['revoked'], list)
                or len(state['revoked']) > 1000 or any(not isinstance(x, str) or not HEX.fullmatch(x) for x in state['revoked'])):
            raise Hold('STATE_SCHEMA')
        previous, seen = '0'*64, set()
        for seq, event in enumerate(state['events'], 1):
            if not isinstance(event, dict) or set(event) != {'seq','nonce','epoch','policyDigest','prev','hash'}:
                raise Hold('LEDGER_SCHEMA')
            item = {k:v for k,v in event.items() if k != 'hash'}
            if (not integer(event['seq']) or event['seq'] != seq or event['prev'] != previous or event['hash'] != digest(canonical(item))
                    or not isinstance(event['nonce'], str) or not HEX.fullmatch(event['nonce'])
                    or event['nonce'] in seen or not integer(event['epoch']) or event['epoch'] > state['epoch']
                    or not isinstance(event['policyDigest'], str) or not HEX.fullmatch(event['policyDigest'])):
                raise Hold('LEDGER_INTEGRITY')
            seen.add(event['nonce']); previous = event['hash']
        if state['epoch'] == 0:
            if state['policy'] is not None or state['policyDigest'] is not None or state['events'] or state['revoked']:
                raise Hold('UNINITIALIZED_STATE_INCONSISTENT')
        else:
            # Validate old signed state even when publishing a replacement. An
            # expired but intact policy may rotate; corrupt policy never heals.
            self.current(state, check_fresh=False)
        if int(time.time()) < state['lastTime']:
            raise Hold('CLOCK_REGRESSION')
        return state

    def verify(self, raw, signature):
        if not isinstance(signature, bytes) or len(signature) != 64:
            raise Hold('SIGNATURE_SIZE')
        with tempfile.TemporaryDirectory(prefix='asi-policy-verify-') as tmp:
            root = Path(tmp)
            for name, value in [('key',self.key),('data',raw),('sig',signature)]:
                new_file(root/name, value)
            # Require Ed25519 rather than accepting an arbitrary verifier/key type.
            key = subprocess.run(['openssl','pkey','-pubin','-in',str(root/'key'),'-outform','DER'], capture_output=True, timeout=5)
            if key.returncode or len(key.stdout) != 44 or key.stdout[:12] != bytes.fromhex('302a300506032b6570032100'):
                raise Hold('ED25519_KEY_REQUIRED')
            result = subprocess.run(['openssl','pkeyutl','-verify','-pubin','-inkey',str(root/'key'),'-rawin','-in',str(root/'data'),'-sigfile',str(root/'sig')], capture_output=True, timeout=5)
            if result.returncode:
                raise Hold('SIGNATURE_INVALID')

    def policy(self, raw, signature, check_fresh=True):
        item = decode(raw, 16384)
        if set(item) != set(self.pins) | {'epoch','issuedAt','expires','clientUid','clientGid','revoked','action'}:
            raise Hold('POLICY_SCHEMA')
        if any(item[k] != v or type(item[k]) is not type(v) for k,v in self.pins.items()):
            raise Hold('POLICY_BINDING')
        if (not integer(item['epoch']) or not integer(item['clientUid']) or not integer(item['clientGid'])
                or item['action'] != 'observe_synthetic' or not isinstance(item['revoked'], list)
                or len(item['revoked']) > 256 or any(not isinstance(x,str) or not HEX.fullmatch(x) for x in item['revoked'])
                or item['revoked'] != sorted(set(item['revoked']))):
            raise Hold('POLICY_FIELDS')
        self.verify(raw, signature)
        if (not integer(item['issuedAt'], 0) or not integer(item['expires'])
                or not 0 < item['expires'] - item['issuedAt'] <= 3600):
            raise Hold('POLICY_TIME_SCHEMA')
        if check_fresh:
            self.fresh(item, 3600)
        return item

    def fresh(self, item, lifetime):
        now = int(time.time())
        if (not integer(item['issuedAt'], 0) or not integer(item['expires'])
                or not item['issuedAt'] <= now < item['expires']
                or not 0 < item['expires'] - item['issuedAt'] <= lifetime):
            raise Hold('EXPIRED_OR_FUTURE')

    def commit(self, state, lock_fd, fault=None):
        root = private(self.root, directory=True)
        lock = private(self.root/'lock')
        held = os.fstat(lock_fd)
        if ((root.st_dev, root.st_ino) != (self.identity.st_dev, self.identity.st_ino)
                or (lock.st_dev, lock.st_ino) != (held.st_dev, held.st_ino)):
            raise Hold('BOUNDARY_REPLACED')
        now = int(time.time())
        if now < state['lastTime']:
            raise Hold('CLOCK_REGRESSION')
        state['lastTime'] = now
        blob = canonical(state)
        if len(blob) > MAX_BYTES:
            raise Hold('STATE_CAPACITY')
        new_file(self.root/'pending', digest(blob).encode())
        sync_dir(self.root)
        if fault: fault('after_intent')
        for name, data in [('state',blob), ('checkpoint',digest(blob).encode())]:
            new_file(self.root/(name+'.next'), data)
            os.replace(self.root/(name+'.next'), self.root/name)
            sync_dir(self.root)
            if fault: fault('after_'+name)
        (self.root/'pending').unlink()
        sync_dir(self.root)
        if fault: fault('after_clear')

    @fail_closed
    def publish(self, raw, signature, *, fault=None):
        with self.locked() as lock_fd:
            state = self.load()
            item = self.policy(raw, signature)
            hashed = digest(raw)
            if item['epoch'] < state['epoch']:
                raise Hold('OLD_EPOCH')
            if item['epoch'] == state['epoch']:
                if hashed != state['policyDigest']:
                    raise Hold('EPOCH_EQUIVOCATION')
                return dict(status='SYNTHETIC_POLICY_UNCHANGED', **FLAGS)
            revoked = sorted(set(state['revoked']) | set(item['revoked']))
            if len(revoked) > 1000:
                raise Hold('REVOCATION_CAPACITY')
            state.update(epoch=item['epoch'], policy={'raw':raw.decode('ascii'),'signature':signature.hex()}, policyDigest=hashed, revoked=revoked)
            self.fresh(item, 3600)
            self.commit(state, lock_fd, fault)
            return dict(status='SYNTHETIC_POLICY_STORED', epoch=item['epoch'], policyDigest=hashed, **FLAGS)

    def current(self, state, check_fresh=True):
        envelope = state['policy']
        if not isinstance(envelope, dict) or set(envelope) != {'raw','signature'}:
            raise Hold('POLICY_MISSING')
        try:
            raw, sig = envelope['raw'].encode('ascii'), bytes.fromhex(envelope['signature'])
        except (ValueError, TypeError, AttributeError, UnicodeError):
            raise Hold('POLICY_CORRUPT') from None
        item = self.policy(raw, sig, check_fresh=check_fresh)
        if item['epoch'] != state['epoch'] or digest(raw) != state['policyDigest'] or not set(item['revoked']).issubset(state['revoked']):
            raise Hold('POLICY_CHECKPOINT')
        return item

    @fail_closed
    def attest(self):
        """Read-only diagnostic, not a signed owner attestation or authority grant."""
        with self.locked() as lock_fd:
            state = self.load(); item = self.current(state)
            return dict(status='SYNTHETIC_POLICY_READBACK', epoch=item['epoch'], policyDigest=state['policyDigest'],
                        expires=item['expires'], consumed=len(state['events']), revokedCount=len(state['revoked']), **FLAGS)

    @fail_closed
    def consume(self, connection, raw, signature, *, fault=None):
        with self.locked() as lock_fd:
            state = self.load(); policy = self.current(state)
            if not isinstance(connection, socket.socket) or connection.family != socket.AF_UNIX or connection.type != socket.SOCK_STREAM:
                raise Hold('UNIX_STREAM_REQUIRED')
            pid, uid, gid = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if pid <= 0 or uid <= 0 or gid <= 0 or uid != policy['clientUid'] or gid != policy['clientGid']:
                raise Hold('KERNEL_PEER_DENIED')
            receipt = decode(raw, 4096)
            expected = set(self.pins) | {'epoch','policyDigest','issuedAt','expires','clientUid','clientGid','action','nonce','seq'}
            if set(receipt) != expected:
                raise Hold('RECEIPT_SCHEMA')
            for key in set(self.pins) | {'epoch','clientUid','clientGid','action'}:
                if receipt[key] != policy[key] or type(receipt[key]) is not type(policy[key]):
                    raise Hold('RECEIPT_BINDING')
            if (receipt['policyDigest'] != state['policyDigest'] or not isinstance(receipt['nonce'],str)
                    or not HEX.fullmatch(receipt['nonce']) or not integer(receipt['seq'])
                    or receipt['seq'] != len(state['events']) + 1):
                raise Hold('RECEIPT_SEQUENCE_OR_BINDING')
            self.verify(raw, signature)
            self.fresh(receipt, 60)
            if receipt['expires'] > policy['expires'] or receipt['nonce'] in state['revoked']:
                raise Hold('REVOKED_OR_POLICY_EXPIRY')
            if any(e['nonce'] == receipt['nonce'] for e in state['events']):
                raise Hold('REPLAY')
            if len(state['events']) >= 1000:
                raise Hold('LEDGER_CAPACITY')
            event = dict(seq=receipt['seq'], nonce=receipt['nonce'], epoch=policy['epoch'],
                         policyDigest=state['policyDigest'], prev=state['events'][-1]['hash'] if state['events'] else '0'*64)
            event['hash'] = digest(canonical(event))
            state['events'].append(event)
            self.fresh(policy, 3600); self.fresh(receipt, 60)
            self.commit(state, lock_fd, fault)
            return dict(status='SYNTHETIC_OBSERVED', seq=receipt['seq'], **FLAGS)
