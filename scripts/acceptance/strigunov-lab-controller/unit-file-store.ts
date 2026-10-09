/**
 * TEST-ONLY temporary-file model, never a protected authorization store.
 * No controller entry point imports this module. Windows ACL/ancestor handle security
 * and directory power-loss durability are NOT established by Node filesystem APIs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonical, check, digest, exact, object, parseCanonical } from './protocol';
import type { ObjectJson } from './protocol';
import { initialModelState, reduceModel } from './state';
const PREFIX = '.strigunov-lab-unit-';
const MAX_JOURNAL = 2 * 1024 * 1024;
const ZERO = '0'.repeat(64);
function identity(p: string) {
  const s = fs.lstatSync(p); check(!s.isSymbolicLink(), 'REPARSE_REJECTED');
  return [String(s.dev), String(s.ino), String(s.birthtimeMs)].join(':');
}
function ancestors(p: string) {
  let current = path.resolve(p);
  for (;;) {
    const info = fs.lstatSync(current);
    check(info.isDirectory() && !info.isSymbolicLink(), 'REPARSE_REJECTED');
    if (process.platform !== 'win32') check((info.mode & 0o022) === 0 || current === path.parse(current).root, 'DIRECTORY_WRITABLE');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
function leaf(p: string, max: number) {
  const s = fs.lstatSync(p);
  check(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.size <= max, 'FILE_UNSAFE');
  if (process.platform !== 'win32') check((s.mode & 0o077) === 0, 'FILE_WRITABLE');
  const fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const after = fs.fstatSync(fd); check(after.ino === s.ino && after.dev === s.dev && after.size <= max, 'FILE_REPLACED');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}
function syncDirectory(p: string) {
  // Windows requires a reviewed native service/handle implementation; never claim it here.
  if (process.platform === 'win32') return;
  const fd = fs.openSync(p, fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeAll(fd: number, text: string) {
  const bytes = Buffer.from(text); let position = 0;
  while (position < bytes.length) {
    const n = fs.writeSync(fd, bytes, position, bytes.length - position);
    check(n > 0, 'SHORT_WRITE'); position += n;
  }
  fs.fsyncSync(fd);
}
function createFile(p: string, text: string) {
  const fd = fs.openSync(p, 'wx', 0o600);
  try { writeAll(fd, text); } finally { fs.closeSync(fd); }
}
function guard(directory: unknown): string {
  check(typeof directory === 'string' && directory.length < 2048);
  const root = path.resolve(directory); check(path.basename(root).startsWith(PREFIX), 'NOT_UNIT_STORE');
  ancestors(root); check(fs.realpathSync(root).toLowerCase() === root.toLowerCase(), 'REPARSE_REJECTED');
  const marker = parseCanonical(leaf(path.join(root, 'unit-only.json'), 2048));
  exact(marker, ['authorityClass','rootIdentity','schemaVersion']);
  check(marker.authorityClass === 'UNIT_ONLY' && marker.schemaVersion === 'asi.lab.unit-store.v1' &&
    marker.rootIdentity === identity(root), 'ROOT_REPLACED');
  const ackDir = path.join(root, 'acks'); ancestors(ackDir);
  return root;
}
function replay(root: string) {
  const text = leaf(path.join(root, 'journal.jsonl'), MAX_JOURNAL);
  check(text.endsWith('\n') && text.length > 1, 'PARTIAL_JOURNAL');
  const lines = text.slice(0, -1).split('\n'); check(lines.length <= 4096, 'JOURNAL_LIMIT');
  const ackNames = fs.readdirSync(path.join(root, 'acks')).sort();
  check(ackNames.length === lines.length, 'ACK_UNKNOWN');
  let state = '', previous = ZERO;
  for (let i = 0; i < lines.length; i++) {
    const row = parseCanonical(lines[i], 32768);
    exact(row, ['body','hash']); const body = object(row.body);
    exact(body, ['schemaVersion','sequence','previous','event','stateDigest']);
    check(body.schemaVersion === 'asi.lab.unit-journal.v1' && body.sequence === i + 1 &&
      body.previous === previous && row.hash === digest(canonical(body)), 'CHAIN_CORRUPT');
    const event = object(body.event);
    if (i === 0) {
      exact(event, ['kind','claims','atMs']); check(event.kind === 'INITIAL' && typeof event.atMs === 'number');
      state = initialModelState(canonical(event.claims), event.atMs);
    } else {
      exact(event, ['kind','command']); check(event.kind === 'TRANSITION');
      state = reduceModel(state, canonical(event.command));
    }
    check(body.stateDigest === digest(state), 'STATE_CORRUPT');
    const ackName = String(i + 1).padStart(8, '0') + '.ack';
    check(ackNames[i] === ackName, 'ACK_GAP');
    const ack = parseCanonical(leaf(path.join(root, 'acks', ackName), 2048));
    exact(ack, ['sequence','hash']); check(ack.sequence === i + 1 && ack.hash === row.hash, 'ACK_CORRUPT');
    previous = String(row.hash);
  }
  return { state, sequence: lines.length, hash: previous };
}
function append(root: string, sequence: number, previous: string, event: ObjectJson, state: string) {
  guard(root);
  const body = { schemaVersion: 'asi.lab.unit-journal.v1', sequence, previous, event, stateDigest: digest(state) };
  const hash = digest(canonical(body)), line = canonical({ body, hash }) + '\n';
  const journal = path.join(root, 'journal.jsonl'), before = fs.lstatSync(journal);
  check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size + Buffer.byteLength(line) <= MAX_JOURNAL);
  const fd = fs.openSync(journal, fs.constants.O_APPEND | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd); check(opened.ino === before.ino && opened.dev === before.dev, 'FILE_REPLACED');
    guard(root); writeAll(fd, line);
  } finally { fs.closeSync(fd); }
  // An append without this separate durable ack is ambiguous and will not be repaired automatically.
  createFile(path.join(root, 'acks', String(sequence).padStart(8, '0') + '.ack'), canonical({ sequence, hash }));
  syncDirectory(path.join(root, 'acks')); syncDirectory(root);
  return hash;
}
/** Creates only a unique hermetic directory. Test cleanup may remove that exact directory. */
export function createUnitStore(parentDirectory: unknown, claimsText: unknown, now: number) {
  check(typeof parentDirectory === 'string'); ancestors(parentDirectory);
  const state = initialModelState(claimsText, now);
  const root = fs.mkdtempSync(path.join(path.resolve(parentDirectory), PREFIX));
  fs.chmodSync(root, 0o700);
  fs.mkdirSync(path.join(root, 'acks'), { mode: 0o700 });
  createFile(path.join(root, 'unit-only.json'), canonical({ authorityClass: 'UNIT_ONLY',
    rootIdentity: identity(root), schemaVersion: 'asi.lab.unit-store.v1' }));
  createFile(path.join(root, 'journal.jsonl'), '');
  const initial = parseCanonical(state);
  append(root, 1, ZERO, { kind: 'INITIAL', claims: initial.claims, atMs: now }, state);
  return { authorityClass: 'UNIT_ONLY', executionAuthorized: false, directory: root };
}
/**
 * Atomic inter-process serialization via exclusive mkdir, plus fsync'd journal and ACK.
 * An abandoned lock is NEVER stolen on timeout, expiry or PID disappearance.
 */
export function applyUnitTransition(directory: unknown, eventText: unknown) {
  let lock: string | undefined;
  try {
    const event = parseCanonical(eventText, 8192); const root = guard(directory);
    lock = path.join(root, 'lease.lock');
    try { fs.mkdirSync(lock, { mode: 0o700 }); } catch {
      return { state: 'RECOVERY_REQUIRED', reason: 'STORE_BUSY_OR_UNCLEAN_LOCK', executionAuthorized: false };
    }
    const prior = replay(root);
    let next: string;
    try { next = reduceModel(prior.state, canonical(event)); } catch {
      fs.rmdirSync(lock); lock = undefined;
      return { state: 'BLOCKED', reason: 'TRANSITION_DENIED', executionAuthorized: false };
    }
    const hash = append(root, prior.sequence + 1, prior.hash, { kind: 'TRANSITION', command: event }, next);
    guard(root); fs.rmdirSync(lock); lock = undefined; syncDirectory(root);
    return { state: 'UNIT_ONLY', leasePhase: parseCanonical(next).phase, executionAuthorized: false,
      journalHead: hash, sequence: prior.sequence + 1 };
  } catch {
    // Leave any acquired lock intact after a possible partial write. Never release/retry an unknown action.
    return { state: 'RECOVERY_REQUIRED', reason: lock ? 'JOURNAL_ACK_UNKNOWN' : 'STORE_UNVERIFIED', executionAuthorized: false };
  }
}
export function inspectUnitStore(directory: unknown) {
  try {
    const root = guard(directory);
    check(!fs.existsSync(path.join(root, 'lease.lock')), 'UNCLEAN_LOCK');
    const result = replay(root);
    return { state: 'UNIT_ONLY', executionAuthorized: false, lease: parseCanonical(result.state),
      journalHead: result.hash, sequence: result.sequence, windowsAuthorityVerified: false };
  } catch { return { state: 'RECOVERY_REQUIRED', executionAuthorized: false, reason: 'STORE_UNVERIFIED' }; }
}
